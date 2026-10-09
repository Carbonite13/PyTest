"""Single-process rooms and bounded WebSocket outbound queues for audio calls."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket

from Pot.config import settings
from Pot.core.log import module_log

__all__ = ["Peer", "Room", "RoomManager", "room_manager"]

logger = module_log(__name__)


@dataclass
class Peer:
    peer_id: str
    websocket: WebSocket
    room_id: Optional[str] = None
    display_name: Optional[str] = None
    admitted: bool = False
    muted: bool = True
    audio_started: bool = False
    speaking: bool = False
    audio_sequence: int = 0
    outbound: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=settings.audio_queue_limit))
    writer_task: Optional[asyncio.Task] = None
    closed: bool = False

    def info(self) -> dict:
        return {"participant_id": self.peer_id, "display_name": self.display_name or self.peer_id[:8], "muted": self.muted, "audio_started": self.audio_started, "speaking": self.speaking}

    async def start_writer(self) -> None:
        self.writer_task = asyncio.create_task(self._writer(), name=f"audio-writer-{self.peer_id}")

    async def _writer(self) -> None:
        try:
            while True:
                item = await self.outbound.get()
                if item is None:
                    self.outbound.task_done()
                    return
                kind, value = item
                try:
                    if kind == "json":
                        await self.websocket.send_json(value)
                    else:
                        await self.websocket.send_bytes(value)
                finally:
                    self.outbound.task_done()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("Peer writer closed for %s: %s", self.peer_id, exc)
            self.closed = True

    def enqueue_json(self, value: dict) -> bool:
        try:
            self.outbound.put_nowait(("json", value))
            return True
        except asyncio.QueueFull:
            return False

    def enqueue_audio(self, metadata: dict, payload: bytes) -> bool:
        if self.outbound.qsize() + 2 > self.outbound.maxsize:
            return False
        try:
            self.outbound.put_nowait(("json", metadata))
            self.outbound.put_nowait(("bytes", payload))
            return True
        except asyncio.QueueFull:
            return False

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self.closed:
            return
        try:
            self.outbound.put_nowait(None)
        except asyncio.QueueFull:
            pass
        try:
            await asyncio.wait_for(self.outbound.join(), timeout=0.25)
        except (asyncio.TimeoutError, RuntimeError):
            pass
        self.closed = True
        if self.writer_task and self.writer_task is not asyncio.current_task():
            self.writer_task.cancel()
        try:
            await self.websocket.close(code=code, reason=reason)
        except Exception:
            pass


@dataclass
class Room:
    room_id: str
    max_participants: int = settings.max_participants_per_room
    host_peer_id: Optional[str] = None
    peers: dict[str, Peer] = field(default_factory=dict)

    @property
    def peer_count(self) -> int:
        return len(self.peers)

    def info(self) -> dict:
        return {"room_id": self.room_id, "host_peer_id": self.host_peer_id, "peer_count": self.peer_count, "max_participants": self.max_participants, "peers": [peer.info() for peer in self.peers.values()]}


class RoomManager:
    """Room registry. It intentionally requires one backend worker."""

    def __init__(self, max_participants: Optional[int] = None):
        self.max_participants = max_participants or settings.max_participants_per_room
        self._rooms: dict[str, Room] = {}
        self._peers: dict[str, Peer] = {}

    async def register_peer(self, websocket: WebSocket) -> Peer:
        peer = Peer(peer_id=uuid.uuid4().hex, websocket=websocket)
        self._peers[peer.peer_id] = peer
        await peer.start_writer()
        return peer

    async def unregister_peer(self, peer_id: str) -> Optional[str]:
        peer = self._peers.pop(peer_id, None)
        if peer is None:
            return None
        room_id = peer.room_id
        self._detach(peer)
        await peer.close()
        return room_id

    def _detach(self, peer: Peer) -> Optional[str]:
        room_id = peer.room_id
        room = self._rooms.get(room_id) if room_id else None
        if room:
            room.peers.pop(peer.peer_id, None)
            if room.host_peer_id == peer.peer_id:
                room.host_peer_id = next(iter(room.peers), None)
            if not room.peers:
                self._rooms.pop(room_id, None)
        peer.room_id = None
        peer.admitted = False
        peer.audio_started = False
        peer.speaking = False
        return room_id

    def join(self, peer_id: str, room_id: str, display_name: Optional[str] = None, is_host: bool = False) -> tuple[Optional[Room], bool, str]:
        peer = self._peers.get(peer_id)
        if peer is None:
            return None, False, "unknown connection"
        if peer.room_id and peer.room_id != room_id:
            return None, False, "leave the current room first"
        room = self._rooms.setdefault(room_id, Room(room_id=room_id, max_participants=self.max_participants))
        if peer_id in room.peers:
            return room, True, "already joined"
        if room.peer_count >= room.max_participants:
            return room, False, "room is full"
        peer.room_id = room_id
        peer.display_name = display_name
        peer.admitted = True
        peer.muted = True
        room.peers[peer_id] = peer
        if room.host_peer_id is None or is_host:
            room.host_peer_id = peer_id
        return room, True, "joined"

    def leave(self, peer_id: str) -> Optional[str]:
        peer = self._peers.get(peer_id)
        return self._detach(peer) if peer and peer.room_id else None

    def get_peer(self, peer_id: str) -> Optional[Peer]:
        return self._peers.get(peer_id)

    def get_room(self, room_id: str) -> Optional[Room]:
        return self._rooms.get(room_id)

    def get_room_peers(self, room_id: str) -> list[Peer]:
        room = self._rooms.get(room_id)
        return list(room.peers.values()) if room else []

    def list_rooms(self) -> list[dict]:
        return [room.info() for room in self._rooms.values()]

    async def send_to_peer(self, peer_id: str, message: dict) -> bool:
        peer = self._peers.get(peer_id)
        return bool(peer and peer.enqueue_json(message))

    async def broadcast_to_room(self, room_id: str, message: dict, exclude_peer_id: Optional[str] = None) -> int:
        sent = 0
        for peer in list(self.get_room_peers(room_id)):
            if peer.peer_id == exclude_peer_id:
                continue
            if peer.enqueue_json(message):
                sent += 1
        return sent

    async def broadcast_audio(self, room_id: str, metadata: dict, payload: bytes, exclude_peer_id: Optional[str] = None) -> int:
        sent = 0
        for peer in list(self.get_room_peers(room_id)):
            if peer.peer_id == exclude_peer_id:
                continue
            if peer.enqueue_audio(metadata, payload):
                sent += 1
            else:
                peer.enqueue_json({"type": "error", "code": 429, "message": "audio receiver is too slow"})
        return sent

    async def terminate_room(self, room_id: str) -> list[Peer]:
        room = self._rooms.pop(room_id, None)
        if not room:
            return []
        peers = list(room.peers.values())
        for peer in peers:
            peer.room_id = None
            peer.admitted = False
            await peer.close(reason="room ended")
            self._peers.pop(peer.peer_id, None)
        return peers


room_manager = RoomManager()
