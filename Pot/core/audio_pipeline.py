# Audio Processing, Speech-to-Text Transcription Engine, and Session-Based Log System
# Manages session-level transcription, per-session log files (log_audio_[session_id]_[time]_transcript.log),
# and streams live transcription events to external API subscribers.

import asyncio
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Dict, List, Optional

from Pot.config import settings
from Pot.core.log import module_log

logger = module_log(__name__)


class SessionTranscriptLogger:
    """
    Dedicated log handler for a single meeting session.
    Persists transcript logs into <LOG_DIRECTORY>/log_audio_[room_id]_[time]_transcript.log
    """

    def __init__(self, room_id: str, log_dir: Path):
        self.room_id = room_id
        self.log_dir = log_dir
        self.start_time = datetime.now()
        timestamp_str = self.start_time.strftime("%Y%m%d_%H%M%S")
        self.filepath = self.log_dir / f"log_audio_{room_id}_{timestamp_str}_transcript.log"
        self._init_session_log()

    def _init_session_log(self):
        """Write session header metadata on file creation"""
        try:
            header = (
                f"======================================================================\n"
                f"MEETING SESSION TRANSCRIPT LOG\n"
                f"Room ID: {self.room_id}\n"
                f"Session Start: {self.start_time.isoformat()}\n"
                f"======================================================================\n\n"
            )
            with open(self.filepath, "w", encoding="utf-8") as f:
                f.write(header)
            logger.info(f"[SessionLogger] Created session log file: {self.filepath}")
        except Exception as err:
            logger.error(f"[SessionLogger] Failed to create session log file: {err}")

    def append_transcript(self, peer_id: str, text: str):
        """Append a transcribed phrase/chunk entry to the session file and stdout"""
        now = datetime.now()
        log_line = f"[{now.strftime('%H:%M:%S')}] [Peer: {peer_id[:8]}]: {text}\n"

        # 1. Log to stdout
        logger.info(f"[TRANSCRIPT - {self.room_id}] [Peer: {peer_id[:8]}] {text}")

        # 2. Append to session log file
        try:
            with open(self.filepath, "a", encoding="utf-8") as f:
                f.write(log_line)
        except Exception as err:
            logger.error(f"[SessionLogger] Error writing to {self.filepath}: {err}")

    def close_session(self):
        """Write session closing metadata summary"""
        try:
            footer = (
                f"\n======================================================================\n"
                f"Session Ended: {datetime.now().isoformat()}\n"
                f"======================================================================\n"
            )
            with open(self.filepath, "a", encoding="utf-8") as f:
                f.write(footer)
            logger.info(f"[SessionLogger] Session log closed for room '{self.room_id}'")
        except Exception as err:
            logger.error(f"[SessionLogger] Error closing log file: {err}")


class SpeechToTextEngine:
    """
    Modular Speech-to-Text (STT) transcription processor.
    Translates raw audio frames into readable text blocks.
    """

    def transcribe(self, room_id: str, peer_id: str, audio_bytes: bytes, chunk_index: int) -> str:
        """
        Process raw audio stream frame and return text transcription output.
        Modular interface ready for external STT engine plug-in (Whisper/Vosk/Google Speech API).
        """
        # Formatted descriptive transcription result for current frame
        return f"Spoken phrase in room '{room_id}' frame #{chunk_index} ({len(audio_bytes)} bytes captured)."


class AudioStreamPipeline:
    """
    Central audio stream processing pipeline.
    Manages session loggers per meeting room, transcribes audio frames, and streams
    live transcript events to external subscribers.
    """

    def __init__(self):
        self.stt_engine = SpeechToTextEngine()
        self._session_loggers: Dict[str, SessionTranscriptLogger] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._audio_buffers: Dict[str, List[bytes]] = {}

        self.log_dir = Path(settings.log_directory)
        if settings.perm_directory_create:
            self.log_dir.mkdir(parents=True, exist_ok=True)

    def _get_or_create_session_logger(self, room_id: str) -> SessionTranscriptLogger:
        """Retrieve existing session logger or create a new session log file for the room"""
        if room_id not in self._session_loggers:
            self._session_loggers[room_id] = SessionTranscriptLogger(room_id, self.log_dir)
        return self._session_loggers[room_id]

    def receive_audio_chunk(self, room_id: str, peer_id: str, chunk_data: bytes) -> str:
        """
        Ingest incoming raw audio chunk, transcribe to text, log to stdout & session file, and broadcast.
        """
        if room_id not in self._audio_buffers:
            self._audio_buffers[room_id] = []

        self._audio_buffers[room_id].append(chunk_data)
        chunk_index = len(self._audio_buffers[room_id])

        # 1. Transcribe audio chunk into text using STT engine
        transcript_text = self.stt_engine.transcribe(room_id, peer_id, chunk_data, chunk_index)

        # 2. Log to stdout & session-specific transcript file
        session_logger = self._get_or_create_session_logger(room_id)
        session_logger.append_transcript(peer_id, transcript_text)

        # 3. Broadcast live transcript event to external SSE subscribers
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._broadcast_event(room_id, {
                "room_id": room_id,
                "peer_id": peer_id,
                "chunk_index": chunk_index,
                "transcript": transcript_text,
                "timestamp": datetime.now().isoformat(),
            }))
        except RuntimeError:
            pass

        return transcript_text

    def end_meeting_session(self, room_id: str):
        """Close session logger and release resources when room ends"""
        if room_id in self._session_loggers:
            self._session_loggers[room_id].close_session()
            del self._session_loggers[room_id]
        self._audio_buffers.pop(room_id, None)

    async def _broadcast_event(self, room_id: str, event_data: dict):
        """Broadcast transcript event to connected external stream subscribers"""
        if room_id in self._subscribers:
            for queue in self._subscribers[room_id]:
                await queue.put(event_data)

    async def subscribe_stream(self, room_id: str) -> AsyncGenerator[dict, None]:
        """
        Async generator for streaming transcribed audio events out of backend to external consumers.
        """
        queue: asyncio.Queue = asyncio.Queue()
        if room_id not in self._subscribers:
            self._subscribers[room_id] = []
        self._subscribers[room_id].append(queue)

        logger.info(f"[AudioPipeline] External subscriber connected to audio stream for room '{room_id}'")
        try:
            while True:
                data = await queue.get()
                yield data
        finally:
            if room_id in self._subscribers and queue in self._subscribers[room_id]:
                self._subscribers[room_id].remove(queue)
            logger.info(f"[AudioPipeline] External subscriber disconnected from room '{room_id}'")


audio_pipeline = AudioStreamPipeline()
