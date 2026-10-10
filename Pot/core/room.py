"""In-memory WebSocket room and peer registry for the P2P WebRTC topology."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket

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

    def info(self) -> dict:
        return {"peer_id": self.peer_id, "display_name": self.display_name}


@dataclass
class Room:
    room_id: str
    host_peer_id: Optional[str] = None
    peers: dict[str, Peer] = field(default_factory=dict)
    waiting_peers: dict[str, Peer] = field(default_factory=dict)

    @property
    def peer_count(self) -> int:
        return len(self.peers)

    def info(self) -> dict:
        return {
            "room_id": self.room_id,
            "host_peer_id": self.host_peer_id,
            "peer_count": self.peer_count,
            "waiting_count": len(self.waiting_peers),
            "peers": [p.info() for p in self.peers.values()],
            "waiting": [p.info() for p in self.waiting_peers.values()],
        }


class RoomManager:
    """Room operations are synchronous and run on the FastAPI event loop."""

    def __init__(self):
        self._rooms: dict[str, Room] = {}
        self._peers: dict[str, Peer] = {}
        logger.info("RoomManager initialized")

    def register_peer(self, websocket: WebSocket) -> Peer:
        peer = Peer(peer_id=uuid.uuid4().hex, websocket=websocket)
        self._peers[peer.peer_id] = peer
        return peer

    def unregister_peer(self, peer_id: str) -> Optional[str]:
        peer = self._peers.pop(peer_id, None)
        if peer is None:
            return None
        room_id = peer.room_id
        if room_id and room_id in self._rooms:
            room = self._rooms[room_id]
            room.peers.pop(peer_id, None)
            room.waiting_peers.pop(peer_id, None)
            if room.peer_count == 0 and not room.waiting_peers:
                self._rooms.pop(room_id, None)
        peer.room_id = None
        return room_id

    def request_join(self, peer_id: str, room_id: str, display_name: Optional[str] = None, admitted: bool = False, host_peer_id: Optional[str] = None) -> tuple[Room, bool]:
        peer = self._peers.get(peer_id)
        if peer is None:
            raise ValueError(f"Unknown peer: {peer_id}")
        if peer.room_id and peer.room_id != room_id:
            self._leave_room_internal(peer)

        room = self._rooms.setdefault(room_id, Room(room_id=room_id, host_peer_id=host_peer_id))
        if not room.host_peer_id and admitted:
            room.host_peer_id = peer_id
        peer.room_id = room_id
        peer.display_name = display_name

        if admitted or peer_id == room.host_peer_id or peer_id in room.peers:
            # A host refresh is authenticated by the session capability before
            # this method is called. Remove the stale socket so two host
            # identities cannot control the same room.
            if admitted and host_peer_id == peer_id and room.host_peer_id and room.host_peer_id != peer_id:
                stale = room.peers.pop(room.host_peer_id, None)
                if stale:
                    stale.room_id = None
                    stale.admitted = False
                room.host_peer_id = peer_id
            peer.admitted = True
            room.waiting_peers.pop(peer_id, None)
            room.peers[peer_id] = peer
            return room, True

        peer.admitted = False
        room.waiting_peers[peer_id] = peer
        return room, False

    def join_room(self, peer_id: str, room_id: str, display_name: Optional[str] = None) -> Room:
        """Compatibility helper for trusted callers that already admitted a peer."""
        room, _ = self.request_join(peer_id, room_id, display_name, admitted=True, host_peer_id=peer_id)
        return room

    def admit_peer(self, host_peer_id: str, target_peer_id: str, room_id: str) -> Optional[Peer]:
        room = self._rooms.get(room_id)
        if not room or room.host_peer_id != host_peer_id:
            return None
        peer = room.waiting_peers.pop(target_peer_id, None)
        if peer:
            peer.admitted = True
            room.peers[target_peer_id] = peer
        return peer

    def reject_peer(self, host_peer_id: str, target_peer_id: str, room_id: str) -> Optional[Peer]:
        room = self._rooms.get(room_id)
        if not room or room.host_peer_id != host_peer_id:
            return None
        peer = room.waiting_peers.pop(target_peer_id, None)
        if peer:
            peer.room_id = None
            peer.admitted = False
        return peer

    def leave_room(self, peer_id: str) -> Optional[str]:
        peer = self._peers.get(peer_id)
        return self._leave_room_internal(peer) if peer and peer.room_id else None

    def _leave_room_internal(self, peer: Peer) -> Optional[str]:
        room_id = peer.room_id
        room = self._rooms.get(room_id) if room_id else None
        if room:
            room.peers.pop(peer.peer_id, None)
            room.waiting_peers.pop(peer.peer_id, None)
            if room.host_peer_id == peer.peer_id:
                room.host_peer_id = next(iter(room.peers), None)
            if room.peer_count == 0 and not room.waiting_peers:
                self._rooms.pop(room_id, None)
        peer.room_id = None
        peer.admitted = False
        return room_id

    def terminate_room(self, room_id: str) -> list[Peer]:
        """Detach every peer from a terminal meeting and return snapshots."""
        room = self._rooms.pop(room_id, None)
        if not room:
            return []
        peers = list(room.peers.values()) + list(room.waiting_peers.values())
        for peer in peers:
            peer.room_id = None
            peer.admitted = False
        return peers

    def get_peer(self, peer_id: str) -> Optional[Peer]:
        return self._peers.get(peer_id)

    def get_room(self, room_id: str) -> Optional[Room]:
        return self._rooms.get(room_id)

    def get_room_peers(self, room_id: str) -> list[Peer]:
        room = self._rooms.get(room_id)
        return list(room.peers.values()) if room else []

    def list_rooms(self) -> list[dict]:
        return [room.info() for room in self._rooms.values()]

    def peers_can_signal(self, sender_id: str, target_id: str) -> bool:
        sender = self._peers.get(sender_id)
        target = self._peers.get(target_id)
        return bool(sender and target and sender.admitted and target.admitted and sender.room_id and sender.room_id == target.room_id)

    async def send_to_peer(self, peer_id: str, message: dict) -> bool:
        peer = self._peers.get(peer_id)
        if peer is None:
            return False
        try:
            await peer.websocket.send_json(message)
            return True
        except Exception as exc:
            logger.warning("Failed to send to peer %s: %s", peer_id, exc)
            return False

    async def broadcast_to_room(self, room_id: str, message: dict, exclude_peer_id: Optional[str] = None) -> int:
        room = self._rooms.get(room_id)
        if not room:
            return 0
        sent = 0
        for peer_id, peer in list(room.peers.items()):
            if peer_id == exclude_peer_id:
                continue
            try:
                await peer.websocket.send_json(message)
                sent += 1
            except Exception as exc:
                logger.warning("Broadcast failed for peer %s: %s", peer_id, exc)
        return sent


room_manager = RoomManager()
