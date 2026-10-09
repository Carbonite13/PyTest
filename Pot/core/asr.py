"""Provider-isolated streaming ASR adapter for Deepgram live transcription."""

from __future__ import annotations

import asyncio
import json
import secrets
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional
from urllib.parse import urlencode

import websockets

from Pot.config import Settings, settings
from Pot.core.log import module_log
from Pot.schema.audio import TranscriptEvent, TranscriptEventType

logger = module_log(__name__)
EventCallback = Callable[[TranscriptEvent], Awaitable[None]]


def _event_id() -> str:
    return secrets.token_urlsafe(18)


class DeepgramASRSession:
    """One raw-PCM stream per participant.

    The adapter is deliberately usable with no API key: in that state it
    reports ``disabled`` and never pretends that recognition succeeded.
    """

    def __init__(self, meeting_id: str, participant_id: str, on_event: EventCallback, config: Settings = settings):
        self.meeting_id = meeting_id
        self.participant_id = participant_id
        self.config = config
        self.on_event = on_event
        self.session_id = _event_id()
        self.sequence_number = 0
        self.websocket = None
        self.reader_task: Optional[asyncio.Task] = None
        self.started = False
        self.closed = False

    @property
    def enabled(self) -> bool:
        return bool(self.config.deepgram_api_key)

    def _url(self) -> str:
        query = urlencode({
            "encoding": self.config.asr_encoding,
            "sample_rate": self.config.asr_sample_rate,
            "channels": 1,
            "model": self.config.asr_model,
            "language": self.config.asr_language,
            "interim_results": "true",
            "punctuate": "true",
        })
        return f"{self.config.deepgram_api_url}?{query}"

    async def start(self) -> str:
        if self.started:
            return "started"
        if not self.enabled:
            await self._emit_status("disabled", "DEEPGRAM_API_KEY is not configured")
            return "disabled"
        try:
            headers = {"Authorization": f"Token {self.config.deepgram_api_key}"}
            try:
                self.websocket = await websockets.connect(self._url(), additional_headers=headers, max_size=2 * 1024 * 1024)
            except TypeError:  # websockets < 14 compatibility
                self.websocket = await websockets.connect(self._url(), extra_headers=headers, max_size=2 * 1024 * 1024)
            self.started = True
            self.reader_task = asyncio.create_task(self._read_results(), name=f"deepgram-{self.participant_id}")
            await self._emit_status("started")
            return "started"
        except Exception as exc:
            await self._emit_status("error", str(exc))
            self.websocket = None
            return "error"

    async def send_audio(self, payload: bytes) -> bool:
        if not self.started or self.closed or not self.websocket:
            return False
        try:
            await self.websocket.send(payload)
            return True
        except Exception as exc:
            await self._emit_status("error", str(exc))
            return False

    async def stop(self) -> None:
        if self.closed:
            return
        self.closed = True
        if self.websocket:
            try:
                await self.websocket.send(json.dumps({"type": "CloseStream"}))
            except Exception:
                pass
            try:
                await self.websocket.close()
            except Exception:
                pass
        if self.reader_task and self.reader_task is not asyncio.current_task():
            self.reader_task.cancel()
            try:
                await self.reader_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        if self.started:
            await self._emit_status("stopped")

    async def _emit_status(self, status: str, message: Optional[str] = None) -> None:
        event = TranscriptEvent(
            event_id=_event_id(), meeting_id=self.meeting_id,
            participant_id=self.participant_id, session_id=self.session_id,
            sequence_number=self.sequence_number, event_type=TranscriptEventType.STATUS,
            text=json.dumps({"status": status, "message": message}) if message else status,
            created_at=datetime.now(timezone.utc),
        )
        self.sequence_number += 1
        await self.on_event(event)

    async def _read_results(self) -> None:
        try:
            async for raw in self.websocket:
                try:
                    data = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                if data.get("type") in {"Error", "error"}:
                    await self._emit_status("error", str(data.get("description") or data.get("message") or "Deepgram error"))
                    continue
                channel = data.get("channel") or {}
                alternative = (channel.get("alternatives") or [{}])[0]
                text = str(alternative.get("transcript") or "").strip()
                if not text:
                    continue
                is_final = bool(data.get("is_final") or data.get("speech_final"))
                event = TranscriptEvent(
                    event_id=_event_id(), meeting_id=self.meeting_id,
                    participant_id=self.participant_id, session_id=self.session_id,
                    sequence_number=self.sequence_number,
                    event_type=TranscriptEventType.FINAL if is_final else TranscriptEventType.PARTIAL,
                    text=text,
                    start_time=float(data["start"]) if data.get("start") is not None else None,
                    end_time=(float(data["start"]) + float(data["duration"])) if data.get("start") is not None and data.get("duration") is not None else None,
                    created_at=datetime.now(timezone.utc),
                )
                self.sequence_number += 1
                await self.on_event(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if not self.closed:
                await self._emit_status("error", str(exc))


class ASRSessionRegistry:
    def __init__(self, config: Settings = settings):
        self.config = config
        self._sessions: dict[str, DeepgramASRSession] = {}

    async def get_or_start(self, meeting_id: str, participant_id: str, on_event: EventCallback) -> DeepgramASRSession:
        session = self._sessions.get(participant_id)
        if session and not session.closed:
            return session
        session = DeepgramASRSession(meeting_id, participant_id, on_event, self.config)
        self._sessions[participant_id] = session
        await session.start()
        return session

    async def stop(self, participant_id: str) -> None:
        session = self._sessions.pop(participant_id, None)
        if session:
            await session.stop()

    async def stop_all(self) -> None:
        for participant_id in list(self._sessions):
            await self.stop(participant_id)


asr_registry = ASRSessionRegistry()
