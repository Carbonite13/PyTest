"""Authenticated FastAPI WebSocket audio rooms and transcript delivery."""

from __future__ import annotations

import json
import math

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from Pot.config import settings
from Pot.core.asr import asr_registry
from Pot.core.downstream import transcript_dispatcher
from Pot.core.log import module_log
from Pot.core.room import Peer, room_manager
from Pot.core.session import SessionStatus, session_manager
from Pot.core.transcript import transcript_service
from Pot.schema.audio import ControlMessage, ControlType, TranscriptEvent

__all__ = ["signalingRouter"]

logger = module_log(__name__)
signalingRouter = APIRouter(tags=["audio"])


def _error(code: int, message: str) -> dict:
    return {"type": "error", "code": code, "message": message}


async def _send(peer: Peer, message: dict) -> None:
    peer.enqueue_json(message)


async def _publish_event(event: TranscriptEvent) -> None:
    accepted, reason = transcript_service.ingest(event)
    if not accepted:
        logger.debug("Transcript event %s rejected: %s", event.event_id, reason)
        return
    prefix = "transcription" if event.event_type.value in {"status", "error"} else "transcript"
    await room_manager.broadcast_to_room(event.meeting_id, {"type": f"{prefix}.{event.event_type.value}", "transcript": event.model_dump(mode="json")})
    await transcript_dispatcher.start()
    transcript_dispatcher.submit(event)


async def _asr_event(event: TranscriptEvent) -> None:
    await _publish_event(event)


async def _start_audio(peer: Peer) -> None:
    if not peer.room_id or not peer.admitted:
        await _send(peer, _error(403, "Join a room before starting audio"))
        return
    peer.audio_started = True
    peer.muted = False
    await asr_registry.get_or_start(peer.room_id, peer.peer_id, _asr_event)
    await room_manager.broadcast_to_room(peer.room_id, {"type": "participant.joined", "participant": peer.info()}, exclude_peer_id=peer.peer_id)


async def _stop_audio(peer: Peer) -> None:
    peer.audio_started = False
    peer.muted = True
    peer.speaking = False
    await asr_registry.stop(peer.peer_id)
    if peer.room_id:
        await room_manager.broadcast_to_room(peer.room_id, {"type": "audio.muted", "participant_id": peer.peer_id}, exclude_peer_id=peer.peer_id)


async def _handle_control(peer: Peer, message: ControlMessage) -> None:
    if message.type == ControlType.PING:
        await _send(peer, {"type": "pong"})
        return
    if message.type == ControlType.ROOM_JOIN:
        if not message.join:
            await _send(peer, _error(400, "join payload is required"))
            return
        session, authorized, reason = session_manager.prepare_audio_join(
            message.join.room_id, peer.peer_id, message.join.meeting_code, message.join.host_token
        )
        if not session or not authorized:
            await _send(peer, _error(410 if session and session.status == SessionStatus.ENDED else 403, reason))
            return
        room, joined, reason = room_manager.join(peer.peer_id, session.session_id, message.join.display_name, is_host=session.host_peer_id == peer.peer_id)
        if not room or not joined:
            await _send(peer, _error(409 if reason == "room is full" else 400, reason))
            return
        session_manager.admit_participant(session.session_id, peer.peer_id)
        await _send(peer, {"type": "room.joined", "room_id": room.room_id, "participant_id": peer.peer_id, "participants": [item.info() for item in room.peers.values()], "max_participants": room.max_participants})
        await room_manager.broadcast_to_room(room.room_id, {"type": "participant.joined", "participant": peer.info()}, exclude_peer_id=peer.peer_id)
        return
    if message.type in {ControlType.ROOM_LEAVE}:
        await _cleanup_peer(peer.peer_id, explicit=True)
        return
    if message.type == ControlType.AUDIO_START:
        await _start_audio(peer)
        return
    if message.type == ControlType.AUDIO_STOP:
        await _stop_audio(peer)
        return
    if message.type in {ControlType.AUDIO_MUTE, ControlType.AUDIO_UNMUTE}:
        if not peer.room_id or not peer.admitted:
            await _send(peer, _error(403, "Join a room before changing microphone state"))
            return
        peer.muted = message.type == ControlType.AUDIO_MUTE
        if peer.muted:
            peer.speaking = False
        await room_manager.broadcast_to_room(peer.room_id, {"type": "audio.muted" if peer.muted else "audio.unmuted", "participant_id": peer.peer_id}, exclude_peer_id=peer.peer_id)
        if peer.muted:
            await room_manager.broadcast_to_room(peer.room_id, {"type": "participant.speaking", "participant_id": peer.peer_id, "speaking": False}, exclude_peer_id=peer.peer_id)
        return
    await _send(peer, _error(400, f"unsupported control message: {message.type.value}"))


async def _handle_audio(peer: Peer, payload: bytes) -> None:
    if not peer.room_id or not peer.admitted:
        await _send(peer, _error(403, "Join a room before sending audio"))
        return
    if not peer.audio_started or peer.muted:
        return
    if len(payload) != settings.audio_packet_bytes:
        await _send(peer, _error(422, f"audio frame must be exactly {settings.audio_packet_bytes} bytes of PCM16"))
        return
    sequence = peer.audio_sequence
    peer.audio_sequence += 1
    samples = memoryview(payload).cast("h")
    rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
    speaking = rms >= 500
    if speaking != peer.speaking:
        peer.speaking = speaking
        await room_manager.broadcast_to_room(peer.room_id, {"type": "participant.speaking", "participant_id": peer.peer_id, "speaking": speaking}, exclude_peer_id=peer.peer_id)
    metadata = {
        "type": "audio.frame",
        "participant_id": peer.peer_id,
        "sequence_number": sequence,
        "timestamp_ms": sequence * 20,
        "sample_rate": settings.asr_sample_rate,
        "channels": 1,
        "sample_format": "s16le",
        "sample_count": len(payload) // 2,
    }
    await room_manager.broadcast_audio(peer.room_id, metadata, payload, exclude_peer_id=peer.peer_id)
    asr = await asr_registry.get_or_start(peer.room_id, peer.peer_id, _asr_event)
    await asr.send_audio(payload)


async def _cleanup_peer(peer_id: str, explicit: bool = False) -> None:
    peer = room_manager.get_peer(peer_id)
    if not peer:
        return
    room_id = peer.room_id
    if peer.audio_started:
        await asr_registry.stop(peer_id)
    if not room_id:
        await room_manager.unregister_peer(peer_id)
        return
    _, meeting_ended = session_manager.handle_peer_disconnect(room_id, peer_id)
    if meeting_ended:
        await room_manager.broadcast_to_room(room_id, {"type": "room.ended", "room_id": room_id, "message": "The host ended the meeting."}, exclude_peer_id=peer_id)
        await room_manager.terminate_room(room_id)
        transcript_service.clear_meeting(room_id)
    else:
        await room_manager.broadcast_to_room(room_id, {"type": "participant.left" if explicit else "participant.disconnected", "participant_id": peer_id}, exclude_peer_id=peer_id)
        room_manager.leave(peer_id)
    await room_manager.unregister_peer(peer_id)


@signalingRouter.get("/rooms")
async def list_rooms():
    return {"rooms": room_manager.list_rooms()}


@signalingRouter.websocket("/ws")
async def audio_websocket(websocket: WebSocket):
    await websocket.accept()
    peer = await room_manager.register_peer(websocket)
    await _send(peer, {"type": "connected", "participant_id": peer.peer_id, "audio_format": {"sample_rate": settings.asr_sample_rate, "channels": 1, "sample_format": "s16le", "packet_bytes": settings.audio_packet_bytes}})
    try:
        while True:
            message = await websocket.receive()
            if message.get("bytes") is not None:
                await _handle_audio(peer, message["bytes"])
                continue
            text = message.get("text")
            if text is None:
                continue
            if len(text.encode("utf-8")) > 16 * 1024:
                await _send(peer, _error(413, "control message too large"))
                continue
            try:
                control = ControlMessage.model_validate(json.loads(text))
            except Exception as exc:
                await _send(peer, _error(400, f"invalid control message: {exc}"))
                continue
            await _handle_control(peer, control)
    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        # Starlette can surface a second receive after a disconnect as a
        # RuntimeError; it is a normal lifecycle path, not an application
        # failure.
        if "disconnect" not in str(exc).lower():
            logger.exception("Audio WebSocket error for %s", peer.peer_id)
    except Exception as exc:
        logger.exception("Audio WebSocket error for %s: %s", peer.peer_id, exc)
    finally:
        await _cleanup_peer(peer.peer_id)
