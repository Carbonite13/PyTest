
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { analyzeTranscript } from "./services/groqService.js";
import { StateManager } from "./stateManager.js";
import { TranscriptBuffer } from "./utils/transcriptBuffer.js";
import { logger } from "./utils/logger.js";

const app = express();

app.get("/", (_req, res) => {
  res.json({ status: "Meeting Analyzer running" });
});

const server = app.listen(config.port, () => {
  logger.success(`Server running on port ${config.port}`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = url.searchParams.get("userId")?.trim();

  // A user ID is required before creating a meeting.
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!userId || !uuidPattern.test(userId)) {
    ws.close(1008, "A valid user UUID is required");
    return;
  }

  const stateManager = new StateManager(userId);
  const transcriptBuffer = new TranscriptBuffer();

  let isProcessing = false;
  let analysisPending = false;

  function sendUpdate() {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: "update",
        data: stateManager.getState()
      }));
    }
  }

  async function triggerAnalysis() {
    if (isProcessing) {
      analysisPending = true;
      return;
    }

    isProcessing = true;
    let failed = false;
    let failedBatch = "";

    try {
      do {
        analysisPending = false;
        failedBatch = "";

        const transcript = transcriptBuffer.takeSmartContext();

        if (!transcript.trim()) break;

        failedBatch = transcript;

        logger.info(`Analyzing meeting for user ${userId}`);

        const newState = await analyzeTranscript(
          stateManager.getState(),
          transcript
        );

        await stateManager.updateState(newState);

        failedBatch = "";
        sendUpdate();

        logger.success(
          `Analysis complete: ${(newState.topics || []).length} topics`
        );
      } while (
        analysisPending ||
        transcriptBuffer.shouldTriggerAnalysis()
      );
    } catch (err) {
      failed = true;
      logger.error(`Analysis failed: ${err.message}`);

      if (failedBatch) {
        transcriptBuffer.restoreContext(failedBatch);
      }
    } finally {
      isProcessing = false;

      // Do not repeatedly retry a failed batch.
      if (
        !failed &&
        (analysisPending || transcriptBuffer.shouldTriggerAnalysis())
      ) {
        setImmediate(() => {
          void triggerAnalysis();
        });
      }
    }
  }

  try {
    await stateManager.initializeMeeting();
    sendUpdate();
    logger.info(`Client connected for user ${userId}`);
  } catch (err) {
    logger.error(`Meeting initialization failed: ${err.message}`);
    ws.close(1011, "Could not initialize meeting");
    return;
  }

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case "transcript": {
          if (typeof data.text !== "string" || !data.text.trim()) {
            break;
          }

          const timestamp =
            data.timestamp || new Date().toISOString();

          const entry = `[${timestamp}] ${data.text.trim()}`;

          // Persist directly to Supabase.
          await stateManager.appendTranscript(entry);

          transcriptBuffer.addEntry(timestamp, data.text.trim());

          logger.data(
            `Buffer: ${transcriptBuffer.wordCount} words`
          );

          sendUpdate();

          if (transcriptBuffer.shouldTriggerAnalysis()) {
            if (isProcessing) {
              analysisPending = true;
            } else {
              await triggerAnalysis();
            }
          }

          break;
        }

        case "get_state":
          sendUpdate();
          break;

        case "reset_meeting":
          await stateManager.reset();
          transcriptBuffer.clear();
          analysisPending = false;
          sendUpdate();
          logger.info("New meeting created");
          break;

        default:
          logger.info(`Unknown message type: ${data.type}`);
      }
    } catch (err) {
      logger.error(`Message handling error: ${err.message}`);
    }
  });

  ws.on("close", () => {
    logger.info(`Client disconnected for user ${userId}`);
  });
});

logger.info("Meeting Analyzer ready and waiting for connections...");
