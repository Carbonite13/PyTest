"""Compatibility boundary for the removed server-side audio pipeline.

The MVP no longer accepts microphone bytes. New code should use
``Pot.core.transcript.transcript_service`` and submit validated text events from
the participant WebSocket.
"""

from __future__ import annotations

from typing import AsyncGenerator

from Pot.core.transcript import transcript_service
from Pot.schema.webrtc import TranscriptEvent


class AudioStreamPipeline:
    def receive_audio_chunk(self, room_id: str, peer_id: str, chunk_data: bytes):
        raise RuntimeError("Server-side audio transcription is disabled; send transcript events instead")

    def receive_transcript_event(self, event: TranscriptEvent) -> tuple[bool, str]:
        return transcript_service.ingest(event)

    async def subscribe_stream(self, room_id: str) -> AsyncGenerator[dict, None]:
        async for event in transcript_service.subscribe(room_id):
            yield event

    def end_meeting_session(self, room_id: str) -> None:
        transcript_service.clear_meeting(room_id)


audio_pipeline = AudioStreamPipeline()
