"""WebRTC signaling and authenticated transcript event transport."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from Pot.config import settings
from Pot.core.log import module_log
from Pot.core.analysis import analysis_bridge
from Pot.core.room import room_manager
from Pot.core.session import SessionStatus, session_manager
from Pot.core.transcript import transcript_service
from Pot.schema.webrtc import ICEServerConfig, SignalMessage, SignalType

__all__ = ["signalingRouter"]

logger = module_log(__name__)
signalingRouter = APIRouter(tags=["webrtc"])


def _ice_servers() -> list[dict]:
    servers = [ICEServerConfig(urls=[settings.stun_server]).model_dump()]
    if settings.turn_server:
        servers.append(ICEServerConfig(urls=[settings.turn_server], username=settings.turn_username, credential=settings.turn_credential).model_dump())
    return servers


@signalingRouter.get("/ice-servers")
async def get_ice_servers():
    return {"ice_servers": _ice_servers()}


@signalingRouter.get("/rooms")
async def list_rooms():
    return {"rooms": room_manager.list_rooms()}


@signalingRouter.get("/rooms/{room_id}")
async def get_room(room_id: str):
    room = room_manager.get_room(room_id)
    if room is None:
        return JSONResponse(status_code=404, content={"status": "error", "message": "Room not found"})
    return {"room_id": room.room_id, "peer_count": room.peer_count, "peers": [p.info() for p in room.peers.values()], "ice_servers": _ice_servers()}


def _legacy_to_canonical(data: dict[str, Any]) -> dict[str, Any]:
    """Accept the old browser envelope while emitting one canonical protocol."""
    data = dict(data)
    message_type = data.get("type")
    if message_type == "join" and "join" not in data and data.get("room_id"):
        data["join"] = {"room_id": data.pop("room_id"), "display_name": data.pop("display_name", None), "host_token": data.pop("host_token", None)}
    elif message_type == "leave" and "leave" not in data and data.get("room_id"):
        data["leave"] = {"room_id": data.pop("room_id")}
    elif message_type in {"offer", "answer"} and isinstance(data.get("sdp"), str) and data.get("target_id"):
        data["sdp"] = {"sdp": data.pop("sdp"), "sdp_type": message_type, "target_peer_id": data.pop("target_id")}
    elif message_type == "ice_candidate" and "ice" not in data and data.get("target_id") and data.get("candidate"):
        candidate = data.pop("candidate")
        if isinstance(candidate, dict):
            data["ice"] = {"candidate": candidate.get("candidate", ""), "sdp_mid": candidate.get("sdpMid"), "sdp_mline_index": candidate.get("sdpMLineIndex"), "target_peer_id": data.pop("target_id")}
    return data


async def _send_error(peer_id: str, code: int, message: str) -> None:
    await room_manager.send_to_peer(peer_id, {"type": SignalType.ERROR.value, "error": {"code": code, "message": message}, "message": message})


async def _terminate_room(room_id: str, message: dict) -> None:
    """Notify admitted and waiting sockets before detaching the room."""
    room = room_manager.get_room(room_id)
    waiting = list(room.waiting_peers.values()) if room else []
    connected = (list(room.peers.values()) + waiting) if room else []
    await room_manager.broadcast_to_room(room_id, message)
    for peer in waiting:
        try:
            await peer.websocket.send_json(message)
        except Exception:
            pass
    room_manager.terminate_room(room_id)
    for peer in connected:
        try:
            await peer.websocket.close(code=1000, reason="Meeting ended")
        except Exception:
            pass


@signalingRouter.websocket("/ws")
async def signaling_websocket(websocket: WebSocket):
    await websocket.accept()
    peer = room_manager.register_peer(websocket)
    await websocket.send_json({"type": "welcome", "peer_id": peer.peer_id})
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode("utf-8")) > 64 * 1024:
                await _send_error(peer.peer_id, 413, "Signaling payload too large")
                continue
            try:
                msg = SignalMessage.model_validate(_legacy_to_canonical(json.loads(raw)))
            except Exception as exc:
                await _send_error(peer.peer_id, 400, f"Invalid message: {exc}")
                continue
            await _handle_signal(peer.peer_id, msg)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("WebSocket error for %s: %s", peer.peer_id, exc)
    finally:
        await _cleanup_peer(peer.peer_id)


async def _handle_signal(peer_id: str, msg: SignalMessage):
    handlers = {
        SignalType.JOIN: _handle_join,
        SignalType.REQUEST_JOIN: _handle_join,
        SignalType.ADMIT_PEER: _handle_admit,
        SignalType.REJECT_PEER: _handle_reject,
        SignalType.LEAVE: _handle_leave,
        SignalType.OFFER: _handle_sdp,
        SignalType.ANSWER: _handle_sdp,
        SignalType.ICE_CANDIDATE: _handle_ice,
        SignalType.TRANSCRIPT: _handle_transcript,
    }
    handler = handlers.get(msg.type)
    if handler:
        await handler(peer_id, msg)
    else:
        await _send_error(peer_id, 400, f"Unsupported message type: {msg.type.value}")


async def _handle_join(peer_id: str, msg: SignalMessage):
    if not msg.join:
        await _send_error(peer_id, 400, "Missing 'join' payload")
        return
    current_peer = room_manager.get_peer(peer_id)
    if current_peer and current_peer.room_id and current_peer.room_id != msg.join.room_id:
        await _send_error(peer_id, 409, "Leave the current meeting before joining another")
        return
    session, admitted, reason = session_manager.prepare_join(msg.join.room_id, peer_id, msg.join.host_token)
    if not session:
        await _send_error(peer_id, 404, reason)
        return
    if session.status == SessionStatus.ENDED:
        await _send_error(peer_id, 410, reason)
        return
    is_host = session.host_peer_id == peer_id
    existing_room = room_manager.get_room(msg.join.room_id)
    already_admitted = bool(existing_room and peer_id in existing_room.peers)
    if is_host and existing_room and existing_room.host_peer_id and existing_room.host_peer_id != peer_id:
        stale_host = room_manager.get_peer(existing_room.host_peer_id)
        if stale_host:
            try:
                await stale_host.websocket.close(code=4001, reason="Host session refreshed")
            except Exception:
                pass
    room, is_admitted = room_manager.request_join(peer_id, msg.join.room_id, msg.join.display_name, admitted=admitted, host_peer_id=session.host_peer_id)
    if not is_admitted:
        await room_manager.send_to_peer(peer_id, {"type": SignalType.WAITING_FOR_HOST.value, "room_id": room.room_id, "message": reason})
        if room.host_peer_id:
            await room_manager.send_to_peer(room.host_peer_id, {"type": SignalType.JOIN_REQUEST_RECVD.value, "peer_event": {"peer_id": peer_id, "display_name": msg.join.display_name or "Guest Peer", "room_id": room.room_id}})
        return

    session_manager.admit_participant(msg.join.room_id, peer_id)
    await analysis_bridge.start(msg.join.room_id, _publish_analysis_update)
    await room_manager.send_to_peer(peer_id, {"type": SignalType.ROOM_INFO.value, "room_id": room.room_id, "is_host": room.host_peer_id == peer_id, "peers": [p.info() for p in room.peers.values() if p.peer_id != peer_id], "ice_servers": _ice_servers()})
    if not already_admitted:
        await room_manager.broadcast_to_room(room.room_id, {"type": SignalType.PEER_JOINED.value, "peer_event": {"peer_id": peer_id, "display_name": room.peers[peer_id].display_name, "room_id": room.room_id}}, exclude_peer_id=peer_id)


async def _handle_admit(host_peer_id: str, msg: SignalMessage):
    if not msg.admission:
        await _send_error(host_peer_id, 400, "Missing 'admission' payload")
        return
    room = room_manager.get_room(msg.admission.room_id)
    if not room or room.host_peer_id != host_peer_id:
        await _send_error(host_peer_id, 403, "Only the active host may admit peers")
        return
    admitted_peer = room_manager.admit_peer(host_peer_id, msg.admission.target_peer_id, msg.admission.room_id)
    if not admitted_peer or not session_manager.admit_participant(msg.admission.room_id, admitted_peer.peer_id):
        await _send_error(host_peer_id, 404, "Join request is no longer available")
        return
    room = room_manager.get_room(msg.admission.room_id)
    await room_manager.send_to_peer(admitted_peer.peer_id, {"type": SignalType.ROOM_INFO.value, "room_id": msg.admission.room_id, "is_host": False, "peers": [p.info() for p in room.peers.values() if p.peer_id != admitted_peer.peer_id], "ice_servers": _ice_servers()})
    await room_manager.broadcast_to_room(msg.admission.room_id, {"type": SignalType.PEER_JOINED.value, "peer_event": {"peer_id": admitted_peer.peer_id, "display_name": admitted_peer.display_name, "room_id": msg.admission.room_id}}, exclude_peer_id=admitted_peer.peer_id)


async def _handle_reject(host_peer_id: str, msg: SignalMessage):
    if not msg.admission:
        await _send_error(host_peer_id, 400, "Missing 'admission' payload")
        return
    rejected = room_manager.reject_peer(host_peer_id, msg.admission.target_peer_id, msg.admission.room_id)
    if rejected:
        await room_manager.send_to_peer(rejected.peer_id, {"type": SignalType.JOIN_REJECTED.value, "room_id": msg.admission.room_id, "message": "Host rejected your request to join the meeting."})
    else:
        await _send_error(host_peer_id, 404, "Join request is no longer available")


async def _handle_leave(peer_id: str, msg: SignalMessage | None = None):
    peer = room_manager.get_peer(peer_id)
    room_id = peer.room_id if peer else None
    if not peer or not room_id:
        return
    if msg and msg.leave and msg.leave.room_id != room_id:
        await _send_error(peer_id, 400, "Leave room does not match active room")
        return
    display_name = peer.display_name
    _, meeting_ended = session_manager.handle_peer_disconnect(room_id, peer_id)
    left_room = room_manager.leave_room(peer_id)
    if not left_room:
        return
    if meeting_ended:
        await _terminate_room(room_id, {"type": "session_ended", "session_id": room_id, "ended_by": peer_id, "message": "The meeting host has left the session."})
        transcript_service.clear_meeting(room_id)
    else:
        await room_manager.broadcast_to_room(left_room, {"type": SignalType.PEER_LEFT.value, "peer_event": {"peer_id": peer_id, "display_name": display_name, "room_id": left_room}})


async def _handle_sdp(peer_id: str, msg: SignalMessage):
    if not msg.sdp:
        await _send_error(peer_id, 400, "Missing 'sdp' payload")
        return
    if not room_manager.peers_can_signal(peer_id, msg.sdp.target_peer_id):
        await _send_error(peer_id, 403, "Target peer is not in your active meeting")
        return
    await room_manager.send_to_peer(msg.sdp.target_peer_id, {"type": msg.type.value, "sdp": {"sdp": msg.sdp.sdp, "sdp_type": msg.sdp.sdp_type, "target_peer_id": peer_id}, "from_peer_id": peer_id})


async def _handle_ice(peer_id: str, msg: SignalMessage):
    if not msg.ice:
        await _send_error(peer_id, 400, "Missing 'ice' payload")
        return
    if not room_manager.peers_can_signal(peer_id, msg.ice.target_peer_id):
        await _send_error(peer_id, 403, "Target peer is not in your active meeting")
        return
    await room_manager.send_to_peer(msg.ice.target_peer_id, {"type": SignalType.ICE_CANDIDATE.value, "ice": {"candidate": msg.ice.candidate, "sdp_mid": msg.ice.sdp_mid, "sdp_mline_index": msg.ice.sdp_mline_index, "target_peer_id": peer_id}, "from_peer_id": peer_id})


async def _handle_transcript(peer_id: str, msg: SignalMessage):
    peer = room_manager.get_peer(peer_id)
    event = msg.transcript
    if not peer or not peer.room_id or not peer.admitted or not event:
        await _send_error(peer_id, 403, "Transcript requires an admitted meeting participant")
        return
    session = session_manager.get_session(event.meeting_id)
    participant_registered = bool(session and peer_id in session.participant_ids)
    if event.meeting_id != peer.room_id or event.participant_id != peer_id or not participant_registered:
        logger.warning(
            "Rejected transcript authorization: admitted=%s room_match=%s participant_match=%s registered=%s",
            peer.admitted,
            event.meeting_id == peer.room_id,
            event.participant_id == peer_id,
            participant_registered,
        )
        await _send_error(peer_id, 403, "Sender is not an authorized meeting participant")
        return
    if event.session_id == "":
        await _send_error(peer_id, 400, "Transcript session_id is required")
        return
    accepted, reason = transcript_service.ingest(event)
    if not accepted:
        await _send_error(peer_id, 409 if reason.startswith("duplicate") or reason == "final_already_committed" else 400, reason)
        return
    await analysis_bridge.send_transcript(peer.room_id, event.model_dump(mode="json"))
    await room_manager.broadcast_to_room(peer.room_id, {"type": SignalType.TRANSCRIPT.value, "transcript": event.model_dump(mode="json")})


async def _publish_analysis_update(room_id: str, message: dict) -> None:
    await room_manager.broadcast_to_room(room_id, message)


async def _cleanup_peer(peer_id: str):
    peer = room_manager.get_peer(peer_id)
    room_id = peer.room_id if peer else None
    display_name = peer.display_name if peer else None
    if not peer:
        return
    _, meeting_ended = session_manager.handle_peer_disconnect(room_id, peer_id) if room_id else (None, False)
    room_manager.unregister_peer(peer_id)
    if not room_id:
        return
    if meeting_ended:
        await _terminate_room(room_id, {"type": "session_ended", "session_id": room_id, "ended_by": peer_id, "message": "The meeting host has disconnected."})
        transcript_service.clear_meeting(room_id)
        await analysis_bridge.stop(room_id)
    else:
        await room_manager.broadcast_to_room(room_id, {"type": SignalType.PEER_LEFT.value, "peer_event": {"peer_id": peer_id, "display_name": display_name, "room_id": room_id}})
