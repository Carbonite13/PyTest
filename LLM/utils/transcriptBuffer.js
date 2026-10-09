// utils/transcriptBuffer.js
import { config } from "../config.js";

export class TranscriptBuffer {
    constructor() {
        this.buffer = "";
        this.wordCount = 0;
    }

    addEntry(timestamp, text) {
        const entry = `[${timestamp}] ${text}\n`;
        this.buffer += entry;
        this.wordCount += text.split(" ").length;
    }

    shouldTriggerAnalysis() {
        return this.wordCount >= config.triggerWordCount;
    }

    resetCounter() {
        this.wordCount = 0;
    }

    getSmartContext() {
        const words = this.buffer.split(" ");

        // If the buffer is getting large, only keep the most recent 2500 words.
        // The LLM already has the "CURRENT STATE" JSON, which summarizes everything before this.
        if (words.length > 2500) {
            return "...[Older conversation is summarized in the CURRENT STATE JSON above]...\n\n" +
                words.slice(-2500).join(" ");
        }

        return this.buffer;
    }

    clear() {
        this.buffer = "";
        this.wordCount = 0;
    }
}
