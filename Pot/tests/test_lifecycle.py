from datetime import datetime, timezone

from Pot.core.room import RoomManager
from Pot.core.session import SessionManager, SessionStatus
from Pot.core.transcript import TranscriptService
from Pot.schema.webrtc import TranscriptEvent
from Pot.schema.webrtc import SignalMessage
import Pot.api.v1.routes.signaling as signaling


class FakeSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


def transcript(event_id: str, event_type: str, sequence: int, text: str = "hello") -> TranscriptEvent:
    return TranscriptEvent(
        event_id=event_id,
        meeting_id="meeting",
        participant_id="participant",
        session_id="asr-session",
        sequence_number=sequence,
        event_type=event_type,
        text=text,
        created_at=datetime.now(timezone.utc),
    )


def test_session_lifecycle_is_terminal_and_host_capability_is_private():
    manager = SessionManager()
    session, token = manager.create_session_with_token("host")
    assert len(session.session_id) >= 20
    assert token not in session.info().values()

    same, admitted, _ = manager.prepare_join(session.session_id, "host")
    assert same is session and admitted
    reclaimed, admitted, _ = manager.prepare_join(session.session_id, "refreshed-host", token)
    assert reclaimed is session and admitted and session.host_peer_id == "refreshed-host"
    assert manager.admit_participant(session.session_id, "refreshed-host")
    assert manager.admit_participant(session.session_id, "guest")
    assert session.status is SessionStatus.ACTIVE
    assert manager.end_session(session.session_id, "guest") is None
    assert manager.end_session(session.session_id, "refreshed-host") is session
    assert manager.prepare_join(session.session_id, "new")[2] == "Meeting has ended"
    assert manager.end_session(session.session_id, "refreshed-host") is session


def test_room_manager_cleans_waiting_peers_and_restricts_cross_room_signaling():
    rooms = RoomManager()
    host_socket, guest_socket, outsider_socket = FakeSocket(), FakeSocket(), FakeSocket()
    host = rooms.register_peer(host_socket)
    guest = rooms.register_peer(guest_socket)
    outsider = rooms.register_peer(outsider_socket)
    rooms.request_join(host.peer_id, "room", admitted=True)
    rooms.request_join(guest.peer_id, "room")
    rooms.request_join(outsider.peer_id, "other", admitted=True)
    assert not rooms.peers_can_signal(host.peer_id, outsider.peer_id)
    assert rooms.get_room("room").waiting_peers[guest.peer_id] is guest
    rooms.unregister_peer(guest.peer_id)
    assert not rooms.get_room("room").waiting_peers


def test_transcript_service_replaces_partials_and_deduplicates_events():
    service = TranscriptService()
    accepted, reason = service.ingest(transcript("partial-1", "partial", 1, "hel"))
    assert accepted and reason == "accepted"
    accepted, _ = service.ingest(transcript("partial-2", "partial", 1, "hello"))
    assert accepted
    assert [e["event_id"] for e in service.committed_events("meeting")] == []
    accepted, _ = service.ingest(transcript("final-01", "final", 1, "hello"))
    assert accepted
    accepted, reason = service.ingest(transcript("final-01", "final", 1, "hello"))
    assert not accepted and reason == "duplicate_event"
    assert [e["event_id"] for e in service.committed_events("meeting")] == ["final-01"]


def test_transcript_websocket_binds_identity_to_admitted_peer():
    import asyncio

    async def run():
        rooms = RoomManager()
        sessions = SessionManager()
        signaling.room_manager = rooms
        signaling.session_manager = sessions
        socket = FakeSocket()
        peer = rooms.register_peer(socket)
        meeting = sessions.create_session(peer.peer_id)
        rooms.request_join(peer.peer_id, meeting.session_id, admitted=True, host_peer_id=peer.peer_id)
        sessions.admit_participant(meeting.session_id, peer.peer_id)
        event = TranscriptEvent(
            event_id="event-0001",
            meeting_id=meeting.session_id,
            participant_id=peer.peer_id,
            session_id="asr-session",
            sequence_number=0,
            event_type="final",
            text="hello",
            created_at=datetime.now(timezone.utc),
        )
        await signaling._handle_transcript(peer.peer_id, SignalMessage(type="transcript", transcript=event))
        assert socket.messages[-1]["type"] == "transcript"
        event.participant_id = "forged-peer"
        await signaling._handle_transcript(peer.peer_id, SignalMessage(type="transcript", transcript=event))
        assert socket.messages[-1]["type"] == "error"

    asyncio.run(run())
