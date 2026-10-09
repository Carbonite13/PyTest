"""Bounded asynchronous forwarding of finalized transcript events."""

from __future__ import annotations

import asyncio
from typing import Optional

try:
    import httpx
except ImportError:  # dependency is installed by Poetry in runtime deployments
    httpx = None

from Pot.config import Settings, settings
from Pot.core.log import module_log
from Pot.schema.audio import TranscriptEvent, TranscriptEventType

logger = module_log(__name__)


class TranscriptDispatcher:
    MAX_QUEUE = 256

    def __init__(self, config: Settings = settings):
        self.config = config
        self.queue: asyncio.Queue[TranscriptEvent] = asyncio.Queue(maxsize=self.MAX_QUEUE)
        self.worker: Optional[asyncio.Task] = None
        self.client = None

    @property
    def enabled(self) -> bool:
        return bool(self.config.downstream_api_url)

    async def start(self) -> None:
        if self.worker or not self.enabled:
            return
        if httpx is None:
            logger.error("Downstream forwarding requires the Poetry-managed httpx dependency")
            return
        self.client = httpx.AsyncClient(timeout=self.config.downstream_api_timeout_seconds)
        self.worker = asyncio.create_task(self._run(), name="transcript-downstream")

    async def stop(self) -> None:
        if self.worker:
            self.worker.cancel()
            try:
                await self.worker
            except asyncio.CancelledError:
                pass
            self.worker = None
        if self.client:
            await self.client.aclose()
            self.client = None

    def submit(self, event: TranscriptEvent) -> bool:
        allowed = event.event_type == TranscriptEventType.FINAL or (event.event_type == TranscriptEventType.PARTIAL and self.config.forward_interim_transcripts)
        if not allowed or not self.enabled:
            return False
        try:
            self.queue.put_nowait(event)
            return True
        except asyncio.QueueFull:
            logger.warning("Downstream transcript queue is full; dropping event %s", event.event_id)
            return False

    async def _run(self) -> None:
        while True:
            event = await self.queue.get()
            await self._deliver(event)

    async def _deliver(self, event: TranscriptEvent) -> None:
        if not self.client or not self.config.downstream_api_url:
            return
        payload = {
            "event_id": event.event_id,
            "meeting_id": event.meeting_id,
            "participant_id": event.participant_id,
            "session_id": event.session_id,
            "text": event.text,
            "start_time": event.start_time,
            "end_time": event.end_time,
            "created_at": event.created_at.isoformat(),
        }
        headers = {"Idempotency-Key": event.event_id}
        if self.config.downstream_api_key:
            headers["Authorization"] = f"Bearer {self.config.downstream_api_key}"
        for attempt in range(3):
            try:
                response = await self.client.post(self.config.downstream_api_url, json=payload, headers=headers)
                response.raise_for_status()
                return
            except Exception as exc:
                if attempt == 2:
                    logger.warning("Downstream delivery failed for %s: %s", event.event_id, exc)
                else:
                    await asyncio.sleep(0.25 * (attempt + 1))


transcript_dispatcher = TranscriptDispatcher()
