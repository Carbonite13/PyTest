# WebRTC Room Manager
# In-memory room and peer state management for the signaling server.
# Handles room lifecycle, peer tracking, and message relay.

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket

from Pot.core.log import module_log

__all__ = ["RoomManager", "room_manager"]

logger = module_log(__name__)


@dataclass
class Peer:
    """Represents a single connected WebRTC peer"""
    peer_id: str
    websocket: WebSocket
    room_id: Optional[str] = None
    display_name: Optional[str] = None

    def info(self) -> dict:
        """Return a serializable summary of this peer"""
        return {
            "peer_id": self.peer_id,
            "display_name": self.display_name,
        }


@dataclass
class Room:
    """Represents a privacy-enabled signaling room that groups peers together"""
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
    """
    Central manager for all rooms and peers.

    Thread-safe through asyncio — all mutations happen within
    the same event loop so no explicit locking is required.
    """

    def __init__(self):
        self._rooms: dict[str, Room] = {}
        self._peers: dict[str, Peer] = {}
        logger.info("RoomManager initialized")

    # ── Peer lifecycle ─────────────────────────────────────────

    def register_peer(self, websocket: WebSocket) -> Peer:
        """Create and register a new peer from an accepted WebSocket"""
        peer_id = uuid.uuid4().hex[:12]
        peer = Peer(peer_id=peer_id, websocket=websocket)
        self._peers[peer_id] = peer
        logger.info(f"Peer registered: {peer_id}")
        return peer

    def unregister_peer(self, peer_id: str) -> Optional[str]:
        """
        Remove a peer from the manager and any room it belongs to.
        Returns the room_id the peer was in (if any) for cleanup notifications.
        """
        peer = self._peers.pop(peer_id, None)
        if peer is None:
            return None

        room_id = peer.room_id
        if room_id and room_id in self._rooms:
            self._rooms[room_id].peers.pop(peer_id, None)
            # garbage-collect empty rooms
            if self._rooms[room_id].peer_count == 0:
                del self._rooms[room_id]
                logger.info(f"Room destroyed (empty): {room_id}")

        logger.info(f"Peer unregistered: {peer_id} (was in room={room_id})")
        return room_id

    # ── Room lifecycle ─────────────────────────────────────────

    # ── Room lifecycle & Privacy Admission ──────────────────────────────

    def join_room(self, peer_id: str, room_id: str, display_name: Optional[str] = None) -> Room:
        """
        Add a peer to a room. First joining peer becomes the meeting host.
        Subsequent peers join or are placed in waiting list depending on host presence.
        """
        peer = self._peers.get(peer_id)
        if peer is None:
            raise ValueError(f"Unknown peer: {peer_id}")

        if peer.room_id and peer.room_id != room_id:
            self._leave_room_internal(peer)

        if room_id not in self._rooms:
            # First peer creates room and becomes HOST
            room = Room(room_id=room_id, host_peer_id=peer_id)
            self._rooms[room_id] = room
            logger.info(f"Room created: {room_id} (Host: {peer_id})")
        else:
            room = self._rooms[room_id]
            if not room.host_peer_id:
                room.host_peer_id = peer_id

        peer.room_id = room_id
        peer.display_name = display_name
        room.peers[peer_id] = peer
        room.waiting_peers.pop(peer_id, None)

        logger.info(f"Peer {peer_id} joined room {room_id} (peers={room.peer_count})")
        return room

    def request_join(self, peer_id: str, room_id: str, display_name: Optional[str] = None) -> tuple[Room, bool]:
        """
        Request joining a room. If room doesn't exist, peer becomes host immediately (returns True).
        If room exists with an active host, peer is added to waiting_peers list (returns False).
        """
        peer = self._peers.get(peer_id)
        if peer is None:
            raise ValueError(f"Unknown peer: {peer_id}")

        peer.display_name = display_name
        peer.room_id = room_id

        if room_id not in self._rooms:
            # Room doesn't exist -> Peer creates & becomes host
            room = self.join_room(peer_id, room_id, display_name)
            return room, True

        room = self._rooms[room_id]
        if room.host_peer_id == peer_id or peer_id in room.peers:
            # Already host or admitted member
            return room, True

        # Place peer in waiting room for host approval
        room.waiting_peers[peer_id] = peer
        logger.info(f"Peer {peer_id} placed in waiting room for {room_id}")
        return room, False

    def admit_peer(self, host_peer_id: str, target_peer_id: str, room_id: str) -> Optional[Peer]:
        """Admit a waiting peer if requested by the room host"""
        room = self._rooms.get(room_id)
        if not room or room.host_peer_id != host_peer_id:
            return None

        peer = room.waiting_peers.pop(target_peer_id, None)
        if peer:
            room.peers[target_peer_id] = peer
            logger.info(f"Host {host_peer_id} admitted peer {target_peer_id} into room {room_id}")
            return peer
        return None

    def reject_peer(self, host_peer_id: str, target_peer_id: str, room_id: str) -> Optional[Peer]:
        """Reject a waiting peer if requested by the room host"""
        room = self._rooms.get(room_id)
        if not room or room.host_peer_id != host_peer_id:
            return None

        peer = room.waiting_peers.pop(target_peer_id, None)
        if peer:
            peer.room_id = None
            logger.info(f"Host {host_peer_id} rejected peer {target_peer_id} from room {room_id}")
            return peer
        return None

    def leave_room(self, peer_id: str) -> Optional[str]:
        """Remove a peer from its current room. Returns the room_id left."""
        peer = self._peers.get(peer_id)
        if peer is None or peer.room_id is None:
            return None
        return self._leave_room_internal(peer)

    def _leave_room_internal(self, peer: Peer) -> Optional[str]:
        room_id = peer.room_id
        if room_id and room_id in self._rooms:
            room = self._rooms[room_id]
            room.peers.pop(peer.peer_id, None)
            room.waiting_peers.pop(peer.peer_id, None)

            # Reassign host if host leaves and other peers remain
            if room.host_peer_id == peer.peer_id:
                if room.peers:
                    room.host_peer_id = next(iter(room.peers.keys()))
                    logger.info(f"Host left room {room_id}. Reassigned host to {room.host_peer_id}")
                else:
                    room.host_peer_id = None

            if room.peer_count == 0 and len(room.waiting_peers) == 0:
                del self._rooms[room_id]
                logger.info(f"Room destroyed (empty): {room_id}")

        peer.room_id = None
        logger.info(f"Peer {peer.peer_id} left room {room_id}")
        return room_id

    # ── Queries ────────────────────────────────────────────────

    def get_peer(self, peer_id: str) -> Optional[Peer]:
        return self._peers.get(peer_id)

    def get_room(self, room_id: str) -> Optional[Room]:
        return self._rooms.get(room_id)

    def get_room_peers(self, room_id: str) -> list[Peer]:
        """Return all peers in a room, excluding none"""
        room = self._rooms.get(room_id)
        if room is None:
            return []
        return list(room.peers.values())

    def list_rooms(self) -> list[dict]:
        """Return summary info for all active rooms"""
        return [room.info() for room in self._rooms.values()]

    # ── Messaging ──────────────────────────────────────────────

    async def send_to_peer(self, peer_id: str, message: dict) -> bool:
        """Send a JSON message to a specific peer. Returns False if peer not found."""
        peer = self._peers.get(peer_id)
        if peer is None:
            logger.warn(f"send_to_peer: peer {peer_id} not found")
            return False
        try:
            await peer.websocket.send_json(message)
            return True
        except Exception as exc:
            logger.error(f"Failed to send to peer {peer_id}: {exc}")
            return False

    async def broadcast_to_room(
        self, room_id: str, message: dict, exclude_peer_id: Optional[str] = None
    ) -> int:
        """
        Broadcast a JSON message to every peer in a room.
        Optionally exclude one peer (typically the sender).
        Returns the number of peers the message was successfully sent to.
        """
        room = self._rooms.get(room_id)
        if room is None:
            return 0

        sent = 0
        for pid, peer in list(room.peers.items()):
            if pid == exclude_peer_id:
                continue
            try:
                await peer.websocket.send_json(message)
                sent += 1
            except Exception as exc:
                logger.error(f"Broadcast failed for peer {pid}: {exc}")
        return sent


# singleton instance shared across the application
room_manager = RoomManager()
