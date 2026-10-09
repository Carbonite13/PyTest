"""REST endpoints for meeting lifecycle.

Media and transcription events stay on the authenticated WebSocket.  This
router intentionally does not accept microphone/audio uploads.
"""

import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from Pot.core.log import module_log
from Pot.core.room import room_manager
from Pot.core.session import SessionStatus, session_manager
from Pot.core.transcript import transcript_service

__all__ = ["sessionsRouter"]

logger = module_log(__name__)
sessionsRouter = APIRouter(tags=["sessions"])


class CreateSessionRequest(BaseModel):
    host_peer_id: Optional[str] = Field(None, min_length=1, max_length=128)
    host_display_name: Optional[str] = Field(None, max_length=128)


class EndSessionRequest(BaseModel):
    peer_id: str = Field(..., min_length=1, max_length=128)
    host_token: Optional[str] = Field(None, min_length=16, max_length=256)


@sessionsRouter.post("/sessions", status_code=201)
async def create_session(body: CreateSessionRequest):
    session, host_token = session_manager.create_session_with_token(body.host_peer_id, body.host_display_name)
    return {
        "status": "created",
        "session": session.info(),
        "host_token": host_token,
        "instructions": {"join_ws": f"Connect to /rtc/ws and send a nested join payload for room_id='{session.session_id}'", "share_code": session.meeting_code},
    }


@sessionsRouter.get("/sessions")
async def list_sessions():
    sessions = session_manager.list_sessions()
    return {"count": len(sessions), "sessions": sessions}


@sessionsRouter.get("/sessions/{session_id}")
async def get_session(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"status": "error", "message": "Session not found"})
    return session.info()


@sessionsRouter.get("/sessions/by-code/{meeting_code}")
async def get_session_by_code(meeting_code: str):
    session = session_manager.get_session_by_code(meeting_code)
    if not session:
        return JSONResponse(status_code=404, content={"status": "error", "message": "Meeting not found"})
    if session.status == SessionStatus.ENDED:
        return JSONResponse(status_code=410, content={"status": "ended", "message": "This meeting has already ended"})
    return session.info()


@sessionsRouter.delete("/sessions/{session_id}")
async def end_session(session_id: str, body: EndSessionRequest):
    session = session_manager.end_session(session_id, body.peer_id, body.host_token)
    if session is None:
        return JSONResponse(status_code=403, content={"status": "error", "message": "Session not found or you are not the host"})
    end_message = {"type": "session_ended", "session_id": session_id, "ended_by": body.peer_id, "message": "The meeting host has ended this session."}
    room = room_manager.get_room(session_id)
    waiting = list(room.waiting_peers.values()) if room else []
    connected = (list(room.peers.values()) + waiting) if room else []
    await room_manager.broadcast_to_room(session_id, end_message)
    for peer in waiting:
        try:
            await peer.websocket.send_json(end_message)
        except Exception:
            pass
    room_manager.terminate_room(session_id)
    for peer in connected:
        try:
            await peer.websocket.close(code=1000, reason="Meeting ended")
        except Exception:
            pass
    transcript_service.clear_meeting(session_id)
    return {"status": "ended", "session": session.info()}


@sessionsRouter.post("/sessions/{session_id}/peers/{peer_id}/audio")
async def reject_raw_audio_upload(session_id: str, peer_id: str):
    """Explicitly reject the legacy server-side transcription path."""
    return JSONResponse(status_code=410, content={"status": "unsupported", "message": "Raw audio uploads are disabled; transcribe locally and send transcript events over /rtc/ws."})


async def _stream_transcripts(session_id: str, peer_id: str):
    room = room_manager.get_room(session_id)
    peer = room.peers.get(peer_id) if room else None
    if not peer or not peer.admitted:
        return JSONResponse(status_code=403, content={"status": "error", "message": "An admitted meeting participant is required"})

    async def events():
        async for event in transcript_service.subscribe(session_id):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@sessionsRouter.get("/sessions/{session_id}/transcript-stream")
async def stream_transcripts(session_id: str, peer_id: str):
    """Authenticated compatibility stream for text events only."""
    return await _stream_transcripts(session_id, peer_id)


@sessionsRouter.get("/sessions/{session_id}/audio-stream")
async def reject_legacy_audio_stream(session_id: str, peer_id: Optional[str] = None):
    """The old endpoint cannot expose raw audio or unauthenticated text."""
    if not peer_id:
        return JSONResponse(status_code=410, content={"status": "unsupported", "message": "Use /transcript-stream with an admitted peer_id; server-side audio transcription is disabled."})
    return await _stream_transcripts(session_id, peer_id)
