# WebRTC Signaling WebSocket route
# Handles the full signaling lifecycle: peer registration,
# room join/leave, SDP offer/answer relay, and ICE candidate trickle.

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse

from Pot.config import settings
from Pot.core.log import module_log
from Pot.core.room import room_manager
from Pot.schema.webrtc import (
    SignalType,
    SignalMessage,
    ICEServerConfig,
    RoomInfoResponse,
)

__all__ = ["signalingRouter"]

logger = module_log(__name__)

signalingRouter = APIRouter(
    tags=["webrtc"],
)


# REST endpoints    
from fastapi.responses import JSONResponse, StreamingResponse
from Pot.core.audio_pipeline import audio_pipeline

@signalingRouter.get("/ice-servers")
async def get_ice_servers():
    """Return the ICE server configuration the client should use"""
    servers = [
        ICEServerConfig(urls=[settings.stun_server]).model_dump(),
    ]
    # include TURN server if configured
    if getattr(settings, "turn_server", None):
        servers.append(
            ICEServerConfig(
                urls=[settings.turn_server],
                username=getattr(settings, "turn_username", None),
                credential=getattr(settings, "turn_credential", None),
            ).model_dump()
        )
    logger.info("ICE server config requested")
    return {"ice_servers": servers}


@signalingRouter.get("/rooms")
async def list_rooms():
    """List all active signaling rooms"""
    rooms = room_manager.list_rooms()
    logger.info(f"Room list requested ({len(rooms)} rooms)")
    return {"rooms": rooms}


@signalingRouter.get("/rooms/{room_id}")
async def get_room(room_id: str):
    """Get information about a specific room"""
    room = room_manager.get_room(room_id)
    if room is None:
        return JSONResponse(
            status_code=404,
            content={"status": "error", "message": f"Room '{room_id}' not found"},
        )
    return RoomInfoResponse(
        room_id=room.room_id,
        peer_count=room.peer_count,
        peers=[p.info() for p in room.peers.values()],
        ice_servers=[ICEServerConfig(urls=[settings.stun_server])],
    ).model_dump()


# Audio Capture & Streaming Endpoints

@signalingRouter.post("/rooms/{room_id}/peers/{peer_id}/audio")
async def ingest_audio_stream(room_id: str, peer_id: str, request: Request):
    """
    Ingest audio stream chunk from client, buffer it, and transcribe internally.
    """
    body = await request.body()
    if not body:
        return JSONResponse(status_code=400, content={"status": "error", "message": "Empty audio payload"})

    transcript = audio_pipeline.receive_audio_chunk(room_id, peer_id, body)
    return {
        "status": "success",
        "room_id": room_id,
        "peer_id": peer_id,
        "bytes_received": len(body),
        "transcript": transcript,
    }


@signalingRouter.get("/rooms/{room_id}/audio-stream")
async def stream_transcribed_audio_out(room_id: str):
    """
    Stream captured audio & transcription events out of backend to external API/consumers via Server-Sent Events (SSE).
    """
    async def event_generator():
        async for event in audio_pipeline.subscribe_stream(room_id):
            yield f"data: {json.dumps(event)}\n\n"

    logger.info(f"External API subscribed to audio stream for room '{room_id}'")
    return StreamingResponse(event_generator(), media_type="text/event-stream")


# WebSocket signaling endpoint 

@signalingRouter.websocket("/ws")
async def signaling_websocket(websocket: WebSocket):
    """
    Main signaling channel.

    Protocol:
      1. Client connects → server assigns a peer_id and sends it back.
      2. Client sends a 'join' message with a room_id.
      3. Server broadcasts 'peer_joined' to existing room members.
      4. Client exchanges 'offer', 'answer', and 'ice_candidate' messages
         with target peers via the server relay.
      5. On disconnect, server broadcasts 'peer_left'.
    """
    await websocket.accept()
    peer = room_manager.register_peer(websocket)
    logger.info(f"WebSocket connected: peer_id={peer.peer_id}")

    # send the peer its assigned id
    await websocket.send_json({
        "type": "welcome",
        "peer_id": peer.peer_id,
    })

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                msg = SignalMessage.model_validate(data)
            except Exception as exc:
                logger.warn(f"Invalid message from {peer.peer_id}: {exc}")
                await websocket.send_json({
                    "type": SignalType.ERROR.value,
                    "error": {"code": 400, "message": f"Invalid message: {exc}"},
                })
                continue

            await _handle_signal(peer.peer_id, msg)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: peer_id={peer.peer_id}")
    except Exception as exc:
        logger.error(f"WebSocket error for {peer.peer_id}: {exc}")
    finally:
        await _cleanup_peer(peer.peer_id)


# Message dispatch

async def _handle_signal(peer_id: str, msg: SignalMessage):
    """Route an incoming SignalMessage to the appropriate handler"""

    match msg.type:
        case SignalType.JOIN:
            await _handle_join(peer_id, msg)
        case SignalType.LEAVE:
            await _handle_leave(peer_id)
        case SignalType.OFFER | SignalType.ANSWER:
            await _handle_sdp(peer_id, msg)
        case SignalType.ICE_CANDIDATE:
            await _handle_ice(peer_id, msg)
        case _:
            logger.warn(f"Unhandled message type from {peer_id}: {msg.type}")
            await room_manager.send_to_peer(peer_id, {
                "type": SignalType.ERROR.value,
                "error": {"code": 400, "message": f"Unsupported message type: {msg.type}"},
            })


async def _handle_join(peer_id: str, msg: SignalMessage):
    """Process a room join request"""
    if msg.join is None:
        await room_manager.send_to_peer(peer_id, {
            "type": SignalType.ERROR.value,
            "error": {"code": 400, "message": "Missing 'join' payload"},
        })
        return

    room = room_manager.join_room(peer_id, msg.join.room_id, msg.join.display_name)
    peer = room_manager.get_peer(peer_id)

    # tell the joining peer about existing members and ICE config
    await room_manager.send_to_peer(peer_id, {
        "type": SignalType.ROOM_INFO.value,
        "room_id": room.room_id,
        "peers": [p.info() for p in room.peers.values() if p.peer_id != peer_id],
        "ice_servers": [ICEServerConfig(urls=[settings.stun_server]).model_dump()],
    })

    # notify existing peers
    await room_manager.broadcast_to_room(room.room_id, {
        "type": SignalType.PEER_JOINED.value,
        "peer_event": {
            "peer_id": peer_id,
            "display_name": peer.display_name if peer else None,
            "room_id": room.room_id,
        },
    }, exclude_peer_id=peer_id)

    logger.info(f"Peer {peer_id} joined room {room.room_id}")


async def _handle_leave(peer_id: str):
    """Process a room leave request"""
    peer = room_manager.get_peer(peer_id)
    room_id = peer.room_id if peer else None
    display_name = peer.display_name if peer else None

    left_room = room_manager.leave_room(peer_id)
    if left_room:
        await room_manager.broadcast_to_room(left_room, {
            "type": SignalType.PEER_LEFT.value,
            "peer_event": {
                "peer_id": peer_id,
                "display_name": display_name,
                "room_id": left_room,
            },
        })
        logger.info(f"Peer {peer_id} left room {left_room}")


async def _handle_sdp(peer_id: str, msg: SignalMessage):
    """Relay an SDP offer or answer to the target peer"""
    if msg.sdp is None:
        await room_manager.send_to_peer(peer_id, {
            "type": SignalType.ERROR.value,
            "error": {"code": 400, "message": "Missing 'sdp' payload"},
        })
        return

    target_id = msg.sdp.target_peer_id
    success = await room_manager.send_to_peer(target_id, {
        "type": msg.type.value,
        "sdp": {
            "sdp": msg.sdp.sdp,
            "sdp_type": msg.sdp.sdp_type,
            "target_peer_id": peer_id,  # tell recipient who sent it
        },
        "from_peer_id": peer_id,
    })

    if not success:
        await room_manager.send_to_peer(peer_id, {
            "type": SignalType.ERROR.value,
            "error": {"code": 404, "message": f"Target peer '{target_id}' not found"},
        })

    logger.info(f"SDP {msg.type.value} relayed: {peer_id} -> {target_id}")


async def _handle_ice(peer_id: str, msg: SignalMessage):
    """Relay an ICE candidate to the target peer"""
    if msg.ice is None:
        await room_manager.send_to_peer(peer_id, {
            "type": SignalType.ERROR.value,
            "error": {"code": 400, "message": "Missing 'ice' payload"},
        })
        return

    target_id = msg.ice.target_peer_id
    success = await room_manager.send_to_peer(target_id, {
        "type": SignalType.ICE_CANDIDATE.value,
        "ice": {
            "candidate": msg.ice.candidate,
            "sdp_mid": msg.ice.sdp_mid,
            "sdp_mline_index": msg.ice.sdp_mline_index,
            "target_peer_id": peer_id,  # tell recipient who sent it
        },
        "from_peer_id": peer_id,
    })

    if not success:
        await room_manager.send_to_peer(peer_id, {
            "type": SignalType.ERROR.value,
            "error": {"code": 404, "message": f"Target peer '{target_id}' not found"},
        })

    logger.info(f"ICE candidate relayed: {peer_id} -> {target_id}")


# Cleanup
async def _cleanup_peer(peer_id: str):
    """Full cleanup when a peer disconnects"""
    peer = room_manager.get_peer(peer_id)
    room_id = peer.room_id if peer else None
    display_name = peer.display_name if peer else None

    room_manager.unregister_peer(peer_id)

    if room_id:
        await room_manager.broadcast_to_room(room_id, {
            "type": SignalType.PEER_LEFT.value,
            "peer_event": {
                "peer_id": peer_id,
                "display_name": display_name,
                "room_id": room_id,
            },
        })

    logger.info(f"Peer {peer_id} fully cleaned up")
