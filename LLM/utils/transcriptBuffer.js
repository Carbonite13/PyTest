
import { config } from "../config.js";

export class TranscriptBuffer {
  constructor() {
    this.buffer = "";
    this.wordCount = 0;
  }

  addEntry(timestamp, text) {
    if (typeof text !== "string" || !text.trim()) return;

    const entry = `[${timestamp}] ${text.trim()}\n`;
    this.buffer += entry;
    this.wordCount += text.trim().split(/\s+/).length;
  }

  shouldTriggerAnalysis() {
    return this.wordCount >= config.triggerWordCount;
  }

  resetCounter() {
    this.wordCount = this.buffer.trim()
      ? this.buffer.trim().split(/\s+/).length
      : 0;
  }

  getSmartContext() {
    if (!this.buffer.trim()) return "";

    const words = this.buffer.trim().split(/\s+/);

    if (words.length > 2500) {
      return (
        "...[Older conversation is summarized in the current meeting state]...\n" +
        words.slice(-2500).join(" ")
      );
    }

    return this.buffer;
  }

  takeSmartContext() {
    const context = this.getSmartContext();

    this.buffer = "";
    this.wordCount = 0;

    return context;
  }

  restoreContext(context) {
    if (!context?.trim()) return;

    this.buffer = context + this.buffer;
    this.resetCounter();
  }

  clear() {
    this.buffer = "";
    this.wordCount = 0;
  }
}
