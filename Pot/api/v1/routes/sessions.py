"""REST endpoints for centralized audio meeting lifecycle."""

from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
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
    await room_manager.broadcast_to_room(session_id, end_message)
    await room_manager.terminate_room(session_id)
    transcript_service.clear_meeting(session_id)
    return {"status": "ended", "session": session.info()}
