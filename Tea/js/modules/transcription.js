/**
 * Client-side transcription boundary.
 *
 * The transport receives text events only.  Browser SpeechRecognition is
 * intentionally opt-in because Chromium implementations may send audio to a
 * vendor service; this adapter reports that limitation instead of claiming
 * offline processing.
 */

function eventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isoNow() {
  return new Date().toISOString();
}

export class BrowserSpeechRecognitionAdapter {
  constructor(options = {}) {
    this.language = options.language || 'en-US';
    this.recognition = null;
    this.handlers = null;
    this.running = false;
    this.privacyNotice = 'Browser speech recognition processing location varies by browser; use only with participant consent.';
  }

  isSupported() {
    return typeof globalThis.SpeechRecognition === 'function' || typeof globalThis.webkitSpeechRecognition === 'function';
  }

  async start(handlers) {
    if (!this.isSupported()) throw new Error('This browser does not provide SpeechRecognition');
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    this.handlers = handlers;
    this.recognition = new Recognition();
    this.recognition.lang = this.language;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim();
        if (text) handlers.onResult?.({ eventType: result.isFinal ? 'final' : 'partial', text });
      }
    };
    this.recognition.onerror = (error) => handlers.onError?.(error.error || 'recognition_error');
    this.recognition.onend = () => {
      this.running = false;
      handlers.onStatus?.('stopped');
    };
    this.recognition.start();
    this.running = true;
    handlers.onStatus?.('started');
  }

  stop() {
    this.running = false;
    this.recognition?.stop();
    this.recognition = null;
  }

  abort() {
    this.running = false;
    this.recognition?.abort();
    this.recognition = null;
  }
}

export class TranscriptionSession {
  constructor({ meetingId, participantId, sendEvent, adapter } = {}) {
    this.meetingId = meetingId;
    this.participantId = participantId;
    this.sendEvent = sendEvent;
    this.adapter = adapter;
    this.sessionId = eventId();
    this.sequenceNumber = 0;
    this.currentPartialSequence = null;
    this.active = false;
  }

  async start() {
    if (!this.adapter) throw new Error('No ASR adapter configured');
    if (this.active) return;
    await this.adapter.start({
      onResult: (result) => this.emit(result.eventType, result.text),
      onError: (message) => this.emit('error', String(message)),
      onStatus: (message) => this.emit('status', String(message)),
    });
    this.active = true;
  }

  emit(eventType, text = null) {
    let sequenceNumber;
    if (eventType === 'partial') {
      if (this.currentPartialSequence === null) this.currentPartialSequence = this.sequenceNumber++;
      sequenceNumber = this.currentPartialSequence;
    } else if (eventType === 'final' && this.currentPartialSequence !== null) {
      sequenceNumber = this.currentPartialSequence;
      this.currentPartialSequence = null;
    } else {
      sequenceNumber = this.sequenceNumber++;
    }
    const event = {
      event_id: eventId(),
      meeting_id: this.meetingId,
      participant_id: this.participantId,
      session_id: this.sessionId,
      sequence_number: sequenceNumber,
      event_type: eventType,
      text,
      start_time: null,
      end_time: null,
      created_at: isoNow(),
      protocol_version: '1',
    };
    this.sendEvent?.(event);
    return event;
  }

  stop() {
    this.adapter?.stop();
    this.active = false;
  }

  abort() {
    this.adapter?.abort?.();
    this.active = false;
  }
}
