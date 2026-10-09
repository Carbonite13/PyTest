# Meeting Session REST Endpoints
# Defines the HTTP API surface for meeting lifecycle management:
#   - Creating a meeting (generates a code, sets host)
#   - Looking up a meeting by code or ID
#   - Ending a meeting (host-only)
#   - Listing all sessions (dev/debug only)
#
# These endpoints do NOT handle WebRTC signaling (see signaling.py).
# They operate on the higher-level MeetingSession abstraction.

import json
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

from Pot.core.log import module_log
from Pot.core.session import session_manager, SessionStatus
from Pot.core.room import room_manager
from Pot.core.audio_pipeline import audio_pipeline

__all__ = ["sessionsRouter"]

logger = module_log(__name__)

sessionsRouter = APIRouter(tags=["sessions"])


# ── Request Models ──────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    """Body for POST /sessions"""
    host_peer_id: str
    host_display_name: Optional[str] = None


class EndSessionRequest(BaseModel):
    """Body for DELETE /sessions/{session_id}"""
    peer_id: str  # Must match the host to be authorised


# ── Endpoints ───────────────────────────────────────────────────────────────

@sessionsRouter.post("/sessions", status_code=201)
async def create_session(body: CreateSessionRequest):
    """
    Create a new meeting session.
    Returns the session info including the generated meeting code and session_id.
    The session_id is the room_id used by the WebSocket signaling layer.
    """
    session = session_manager.create_session(
        host_peer_id=body.host_peer_id,
        host_display_name=body.host_display_name,
    )
    # Immediately join the host into the signaling room
    # (host connects over WS after calling this, so the room will be created lazily on join)
    logger.info(f"Session created via API: {session.session_id} code={session.meeting_code}")
    return {
        "status": "created",
        "session": session.info(),
        "instructions": {
            "join_ws": f"Connect to /rtc/ws and send a 'join' message with room_id='{session.session_id}'",
            "share_code": f"Share meeting code '{session.meeting_code}' with participants",
        },
    }


@sessionsRouter.get("/sessions")
async def list_sessions():
    """List all sessions (active, waiting, and ended)."""
    sessions = session_manager.list_sessions()
    return {"count": len(sessions), "sessions": sessions}


@sessionsRouter.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get full metadata for a specific session by its ID."""
    session = session_manager.get_session(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"status": "error", "message": "Session not found"})
    return session.info()


@sessionsRouter.get("/sessions/by-code/{meeting_code}")
async def get_session_by_code(meeting_code: str):
    """Resolve a human-readable meeting code to its session info."""
    session = session_manager.get_session_by_code(meeting_code)
    if not session:
        return JSONResponse(status_code=404, content={"status": "error", "message": f"No session with code '{meeting_code}'"})
    if session.status == SessionStatus.ENDED:
        return JSONResponse(status_code=410, content={"status": "ended", "message": "This meeting has already ended"})
    return session.info()


@sessionsRouter.delete("/sessions/{session_id}")
async def end_session(session_id: str, body: EndSessionRequest):
    """
    Terminate a meeting session.  Only the session host may call this.
    Broadcasts 'session_ended' to all connected peers in the signaling room,
    closes session log, and marks the session as ended.
    """
    session = session_manager.end_session(session_id, requester_peer_id=body.peer_id)
    if session is None:
        return JSONResponse(
            status_code=403,
            content={"status": "error", "message": "Session not found or you are not the host"},
        )

    # Notify all peers in the signaling room that the meeting is over
    await room_manager.broadcast_to_room(session_id, {
        "type": "session_ended",
        "session_id": session_id,
        "ended_by": body.peer_id,
        "message": "The meeting host has ended this session.",
    })

    # Close the session-level audio transcript log
    audio_pipeline.end_meeting_session(session_id)

    logger.info(f"Session {session_id} ended and resources released")
    return {"status": "ended", "session": session.info()}


# ── Audio Capture & SSE Stream ───────────────────────────────────────────────
# Grouped here with session context since they are session-scoped operations.

@sessionsRouter.post("/sessions/{session_id}/peers/{peer_id}/audio")
async def ingest_audio_chunk(session_id: str, peer_id: str, request: Request):
    """
    Accept a raw audio chunk (audio/webm) from a peer, pass it through the
    transcription pipeline, and return the resulting transcript entry.
    """
    body = await request.body()
    if not body:
        return JSONResponse(status_code=400, content={"status": "error", "message": "Empty audio payload"})

    session = session_manager.get_session(session_id)
    if not session or session.status == SessionStatus.ENDED:
        return JSONResponse(status_code=404, content={"status": "error", "message": "Session not found or ended"})

    transcript = audio_pipeline.receive_audio_chunk(session_id, peer_id, body)
    return {
        "status": "ok",
        "session_id": session_id,
        "peer_id": peer_id,
        "bytes_received": len(body),
        "transcript": transcript,
    }


@sessionsRouter.get("/sessions/{session_id}/audio-stream")
async def stream_session_audio(session_id: str):
    """
    Subscribe to the live transcription event stream for a session via Server-Sent Events.
    Intended for external consumers (AI assistants, note-takers, live caption services).
    """
    async def event_generator():
        async for event in audio_pipeline.subscribe_stream(session_id):
            yield f"data: {json.dumps(event)}\n\n"

    logger.info(f"SSE consumer attached to session '{session_id}' audio stream")
    return StreamingResponse(event_generator(), media_type="text/event-stream")
