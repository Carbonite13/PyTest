// server.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Bypass strict SSL for corporate networks/proxies
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { analyzeTranscript } from "./services/groqService.js";
import { StateManager } from "./stateManager.js";
import { TranscriptBuffer } from "./utils/transcriptBuffer.js";
import { logger } from "./utils/logger.js";
import { initDb } from "./supabase.js";
const app = express();
const server = app.listen(config.port, () => {
    logger.success(`Server running on port ${config.port}`);
});

const wss = new WebSocketServer({ server });

// Initialize services
const stateManager = new StateManager();
const transcriptBuffer = new TranscriptBuffer();
let isProcessing = false;

// Broadcast to all connected UI clients
function broadcastToUI() {
    const payload = JSON.stringify({
        type: "update",
        data: stateManager.getState()
    });

    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // 1 means OPEN
            client.send(payload);
        }
    });
}

// Core analysis function
async function triggerAnalysis() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        logger.info("Starting Groq analysis...");
        const currentState = stateManager.getState();
        const transcript = transcriptBuffer.getSmartContext(); // NEW

        const newState = await analyzeTranscript(currentState, transcript);
        stateManager.updateState(newState);
        broadcastToUI();

        logger.success(`Analysis complete. ${newState.topics.length} topics identified.`);
    } catch (err) {
        logger.error(`Analysis failed: ${err.message}`);
    } finally {
        isProcessing = false;
    }
}

// Handle WebSocket connections
wss.on("connection", (ws) => {
    logger.info("Client connected");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message.toString());

            // 1. Handle incoming transcript from STT or Mock Script
            if (data.type === "transcript") {
                transcriptBuffer.addEntry(data.timestamp, data.text);
                logger.data(`Buffer: ${transcriptBuffer.wordCount} words`);

                if (transcriptBuffer.shouldTriggerAnalysis() && !isProcessing) {
                    transcriptBuffer.resetCounter();
                    triggerAnalysis();
                }
            }

            // 2. Handle UI requesting current state on load
            if (data.type === "get_state") {
                ws.send(JSON.stringify({
                    type: "update",
                    data: stateManager.getState()
                }));
            }

            // 3. Handle meeting reset (e.g., starting a brand new meeting)
            if (data.type === "reset_meeting") {
                stateManager.reset();
                transcriptBuffer.clear();
                broadcastToUI();
                logger.info("Meeting state reset");
            }
        } catch (err) {
            logger.error(`Message handling error: ${err.message}`);
        }
    });

    ws.on("close", () => {
        logger.info("Client disconnected");
    });
});

logger.info(" Meeting Analyzer ready and waiting for connections...");