# Audio Processing and In-Memory Streaming Pipeline
# Captures audio chunks sent via WebSocket/REST, buffers them in memory,
# performs transcription simulation/STT integration, and streams transcribed audio events to external consumers.

import asyncio
from typing import AsyncGenerator, Dict, List
from Pot.core.log import module_log

logger = module_log(__name__)


class AudioStreamPipeline:
    """
    Manages in-memory audio chunk buffering per room/peer, transcription generation,
    and streaming outbound events to external subscriber services/APIs.
    """

    def __init__(self):
        # Room ID -> List of subscriber asyncio Queues
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        # Room ID -> Audio buffer list
        self._audio_buffers: Dict[str, List[bytes]] = {}

    def receive_audio_chunk(self, room_id: str, peer_id: str, chunk_data: bytes) -> str:
        """
        Ingest incoming raw audio chunk, append to buffer, and trigger transcription.
        """
        if room_id not in self._audio_buffers:
            self._audio_buffers[room_id] = []
        
        self._audio_buffers[room_id].append(chunk_data)
        logger.info(f"[AudioPipeline] Received {len(chunk_data)} bytes of audio from {peer_id} in room {room_id}")

        # Simulated dynamic transcription result based on chunk sequence
        chunk_index = len(self._audio_buffers[room_id])
        transcript_text = f"[Transcript - Room {room_id} | Peer {peer_id[:6]}]: Audio chunk #{chunk_index} captured and processed successfully."

        # Broadcast transcript event to all room stream subscribers
        asyncio.create_task(self._broadcast_event(room_id, {
            "room_id": room_id,
            "peer_id": peer_id,
            "chunk_index": chunk_index,
            "chunk_bytes": len(chunk_data),
            "transcript": transcript_text,
        }))

        return transcript_text

    async def _broadcast_event(self, room_id: str, event_data: dict):
        """Broadcast transcript/audio event to connected external stream subscribers"""
        if room_id in self._subscribers:
            for queue in self._subscribers[room_id]:
                await queue.put(event_data)

    async def subscribe_stream(self, room_id: str) -> AsyncGenerator[dict, None]:
        """
        Async generator for streaming transcribed audio events out of the backend
        to external APIs or clients.
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
