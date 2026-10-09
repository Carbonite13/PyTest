# Meeting Session Manager
# Tracks meeting lifecycle: creation, active state, and termination.
# Independent of the real-time signaling layer; it stores session metadata
# (meeting code, host, participants, timestamps) that persist for the session duration.

import secrets
import string
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional

from Pot.core.log import module_log

__all__ = ["SessionStatus", "MeetingSession", "SessionManager", "session_manager"]

logger = module_log(__name__)


class SessionStatus(str, Enum):
    """Lifecycle states a meeting session can be in"""
    WAITING   = "waiting"    # Created, host connected, waiting for participants
    ACTIVE    = "active"     # At least one participant admitted and media flowing
    ENDED     = "ended"      # Host ended the meeting or all participants left


def _generate_meeting_code(length: int = 9) -> str:
    """
    Generate a human-readable meeting code in the format: XXX-XXX-XXX
    Uses uppercase letters and digits for readability (no ambiguous chars).
    """
    alphabet = string.ascii_uppercase.replace("O", "").replace("I", "") + string.digits.replace("0", "")
    raw = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{raw[:3]}-{raw[3:6]}-{raw[6:]}"


@dataclass
class MeetingSession:
    """
    Holds all metadata for a single meeting session.

    Lifecycle:
      WAITING → ACTIVE (once first participant joins)
      ACTIVE  → ENDED  (host calls end or room empties)
    """
    session_id: str         # Stable internal ID (== room_id used in signaling)
    meeting_code: str       # Human-friendly join code shown to users
    host_peer_id: str       # Peer that created the session
    host_display_name: Optional[str]
    status: SessionStatus = SessionStatus.WAITING
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    started_at: Optional[str] = None   # Set when first participant is admitted
    ended_at: Optional[str] = None     # Set when session is terminated
    participant_ids: list[str] = field(default_factory=list)  # Admitted participants

    def info(self) -> dict:
        """Serializable session summary for API responses"""
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
    """
    Manages the full lifecycle of meeting sessions.

    Separates business-level session concerns (meeting code, status, participants)
    from the low-level signaling room mechanics in RoomManager.
    """

    def __init__(self):
        # session_id -> MeetingSession
        self._sessions: dict[str, MeetingSession] = {}
        # meeting_code -> session_id (for O(1) code lookup)
        self._code_index: dict[str, str] = {}
        logger.info("SessionManager initialized")

    # ── Session Creation ───────────────────────────────────────────────────

    def create_session(self, host_peer_id: str, host_display_name: Optional[str] = None) -> MeetingSession:
        """
        Create a new meeting session.  Returns the session with a generated meeting code.
        The session_id is used as the room_id throughout the signaling layer.
        """
        # Collision-safe code generation
        for _ in range(10):
            code = _generate_meeting_code()
            if code not in self._code_index:
                break

        import uuid
        session_id = uuid.uuid4().hex[:12]
        session = MeetingSession(
            session_id=session_id,
            meeting_code=code,
            host_peer_id=host_peer_id,
            host_display_name=host_display_name,
        )
        self._sessions[session_id] = session
        self._code_index[code] = session_id
        logger.info(f"Session created: {session_id} code={code} host={host_peer_id}")
        return session

    # ── Participant Management ─────────────────────────────────────────────

    def admit_participant(self, session_id: str, peer_id: str) -> bool:
        """
        Record an admitted participant. Transitions session WAITING → ACTIVE on first admit.
        Returns False if session not found or already ended.
        """
        session = self._sessions.get(session_id)
        if not session or session.status == SessionStatus.ENDED:
            return False

        if peer_id not in session.participant_ids:
            session.participant_ids.append(peer_id)

        if session.status == SessionStatus.WAITING:
            session.status = SessionStatus.ACTIVE
            session.started_at = datetime.now().isoformat()
            logger.info(f"Session {session_id} transitioned WAITING → ACTIVE")

        return True

    def remove_participant(self, session_id: str, peer_id: str):
        """Remove a participant (on leave/disconnect)."""
        session = self._sessions.get(session_id)
        if session and peer_id in session.participant_ids:
            session.participant_ids.remove(peer_id)

    # ── Session Termination ────────────────────────────────────────────────

    def end_session(self, session_id: str, requester_peer_id: str) -> Optional[MeetingSession]:
        """
        Terminate a session.  Only the host may end the session.
        Returns the ended session on success, None if not found or unauthorized.
        """
        session = self._sessions.get(session_id)
        if not session:
            return None
        if session.host_peer_id != requester_peer_id:
            logger.warn(f"Unauthorized end_session attempt by {requester_peer_id} for {session_id}")
            return None

        session.status = SessionStatus.ENDED
        session.ended_at = datetime.now().isoformat()
        logger.info(f"Session {session_id} ended by host {requester_peer_id}")
        return session

    # ── Queries ───────────────────────────────────────────────────────────

    def get_session(self, session_id: str) -> Optional[MeetingSession]:
        return self._sessions.get(session_id)

    def get_session_by_code(self, meeting_code: str) -> Optional[MeetingSession]:
        """Resolve a human-readable meeting code to its session"""
        session_id = self._code_index.get(meeting_code.upper())
        return self._sessions.get(session_id) if session_id else None

    def list_sessions(self) -> list[dict]:
        return [s.info() for s in self._sessions.values()]


session_manager = SessionManager()
