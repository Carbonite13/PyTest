"""Meeting lifecycle state and capability management."""

from __future__ import annotations

import hashlib
import secrets
import string
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from Pot.core.log import module_log

__all__ = ["SessionStatus", "MeetingSession", "SessionManager", "session_manager"]

logger = module_log(__name__)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionStatus(str, Enum):
    WAITING = "waiting"
    ACTIVE = "active"
    ENDED = "ended"


def _generate_meeting_code(length: int = 9) -> str:
    alphabet = string.ascii_uppercase.replace("O", "").replace("I", "") + string.digits.replace("0", "")
    raw = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{raw[:3]}-{raw[3:6]}-{raw[6:]}"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class MeetingSession:
    session_id: str
    meeting_code: str
    host_peer_id: Optional[str]
    host_display_name: Optional[str]
    host_token_hash: str = ""
    status: SessionStatus = SessionStatus.WAITING
    created_at: str = field(default_factory=utc_now)
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    participant_ids: list[str] = field(default_factory=list)

    def info(self) -> dict:
        return {
            "session_id": self.session_id,
            "meeting_code": self.meeting_code,
            "host_peer_id": self.host_peer_id,
            "host_display_name": self.host_display_name,
            "status": self.status.value,
            "participant_count": len(self.participant_ids),
            "created_at": self.created_at,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
        }


class SessionManager:
    """In-process lifecycle registry used by the current single-worker app."""

    def __init__(self):
        self._sessions: dict[str, MeetingSession] = {}
        self._code_index: dict[str, str] = {}
        self._lock = threading.RLock()
        logger.info("SessionManager initialized")

    def create_session(self, host_peer_id: Optional[str], host_display_name: Optional[str] = None) -> MeetingSession:
        """Create a session (legacy-compatible object-only API)."""
        session, _ = self.create_session_with_token(host_peer_id, host_display_name)
        return session

    def create_session_with_token(self, host_peer_id: Optional[str], host_display_name: Optional[str] = None) -> tuple[MeetingSession, str]:
        """Create a session and return its one-time host capability."""
        with self._lock:
            for _ in range(100):
                code = _generate_meeting_code()
                if code not in self._code_index:
                    break
            else:  # pragma: no cover
                raise RuntimeError("Unable to allocate a unique meeting code")
            session_id = secrets.token_urlsafe(18)
            host_token = secrets.token_urlsafe(32)
            session = MeetingSession(
                session_id=session_id,
                meeting_code=code,
                host_peer_id=host_peer_id,
                host_display_name=host_display_name,
                host_token_hash=_hash_token(host_token),
            )
            self._sessions[session_id] = session
            self._code_index[code] = session_id
            logger.info("Session created: %s code=%s", session_id, code)
            return session, host_token

    def verify_host_token(self, session_id: str, token: Optional[str]) -> bool:
        if not token:
            return False
        with self._lock:
            session = self._sessions.get(session_id)
            return bool(session and session.status != SessionStatus.ENDED and secrets.compare_digest(session.host_token_hash, _hash_token(token)))

    def prepare_join(self, session_id: str, peer_id: str, host_token: Optional[str] = None) -> tuple[Optional[MeetingSession], bool, str]:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return None, False, "Meeting not found"
            if session.status == SessionStatus.ENDED:
                return session, False, "Meeting has ended"
            if peer_id == session.host_peer_id:
                return session, True, "ok"
            if self.verify_host_token(session_id, host_token):
                session.host_peer_id = peer_id
                return session, True, "ok"
            # Possession of the meeting code/session identifier grants entry
            # to the current meeting. Host-only capabilities remain required
            # for ending the session or changing host ownership.
            return session, True, "ok"

    def admit_participant(self, session_id: str, peer_id: str) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session or session.status == SessionStatus.ENDED:
                return False
            if peer_id not in session.participant_ids:
                session.participant_ids.append(peer_id)
            if session.status == SessionStatus.WAITING:
                session.status = SessionStatus.ACTIVE
                session.started_at = utc_now()
            return True

    def remove_participant(self, session_id: str, peer_id: str) -> Optional[MeetingSession]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session and peer_id in session.participant_ids:
                session.participant_ids.remove(peer_id)
            return session

    def end_session(self, session_id: str, requester_peer_id: str, host_token: Optional[str] = None) -> Optional[MeetingSession]:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return None
            if session.status == SessionStatus.ENDED:
                # Repeating a host termination is safe and idempotent; it
                # cannot change any state or revive the meeting.
                return session if requester_peer_id == session.host_peer_id else None
            is_host = requester_peer_id == session.host_peer_id or self.verify_host_token(session_id, host_token)
            if not is_host:
                logger.warning("Unauthorized end_session attempt for %s", session_id)
                return None
            session.status = SessionStatus.ENDED
            session.ended_at = utc_now()
            session.participant_ids.clear()
            logger.info("Session ended: %s", session_id)
            return session

    def handle_peer_disconnect(self, session_id: str, peer_id: str) -> tuple[Optional[MeetingSession], bool]:
        """Remove a participant; host departure terminates the meeting."""
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return None, False
            was_host = peer_id == session.host_peer_id
            if peer_id in session.participant_ids:
                session.participant_ids.remove(peer_id)
            if was_host and session.status != SessionStatus.ENDED:
                session.status = SessionStatus.ENDED
                session.ended_at = utc_now()
                session.participant_ids.clear()
                return session, True
            return session, False

    def get_session(self, session_id: str) -> Optional[MeetingSession]:
        with self._lock:
            return self._sessions.get(session_id)

    def get_session_by_code(self, meeting_code: str) -> Optional[MeetingSession]:
        with self._lock:
            session_id = self._code_index.get(meeting_code.upper())
            return self._sessions.get(session_id) if session_id else None

    def list_sessions(self) -> list[dict]:
        with self._lock:
            return [s.info() for s in self._sessions.values()]


session_manager = SessionManager()
