import asyncio
import json
from types import SimpleNamespace

from Pot.core.asr import DeepgramASRSession
from Pot.core.room import RoomManager
from Pot.core.transcript import TranscriptService
from Pot.schema.audio import ControlMessage, ControlType, TranscriptEventType


class FakeSocket:
    def __init__(self):
        self.json_messages = []
        self.binary_messages = []
        self.closed = False

    async def send_json(self, message):
        self.json_messages.append(message)

    async def send_bytes(self, payload):
        self.binary_messages.append(payload)

    async def close(self, **kwargs):
        self.closed = True


def test_audio_room_relay_preserves_source_and_binary_order():
    async def run():
        rooms = RoomManager(max_participants=2)
        source_socket, receiver_socket = FakeSocket(), FakeSocket()
        source = await rooms.register_peer(source_socket)
        receiver = await rooms.register_peer(receiver_socket)
        room, joined, _ = rooms.join(source.peer_id, "meeting-room-1234567890", "Alice")
        assert joined and room.host_peer_id == source.peer_id
        _, joined, _ = rooms.join(receiver.peer_id, room.room_id, "Bob")
        assert joined
        payload = bytes(640)
        metadata = {"type": "audio.frame", "participant_id": source.peer_id, "sequence_number": 0}
        await rooms.broadcast_audio(room.room_id, metadata, payload, exclude_peer_id=source.peer_id)
        await asyncio.sleep(0)
        assert receiver_socket.json_messages[-1] == metadata
        assert receiver_socket.binary_messages[-1] == payload
        await rooms.unregister_peer(source.peer_id)
        await rooms.unregister_peer(receiver.peer_id)

    asyncio.run(run())


def test_audio_control_schema_rejects_unknown_fields():
    message = ControlMessage.model_validate({"type": ControlType.PING.value})
    assert message.type is ControlType.PING
    try:
        ControlMessage.model_validate({"type": "ping", "participant_id": "forged"})
    except ValueError:
        pass
    else:
        raise AssertionError("client-supplied identity must not be accepted")


def test_transcript_service_replaces_partials_and_commits_final_once():
    from datetime import datetime, timezone
    from Pot.schema.audio import TranscriptEvent

    service = TranscriptService()

    def event(event_id, event_type, text):
        return TranscriptEvent(event_id=event_id, meeting_id="room", participant_id="p1", session_id="asr", sequence_number=1, event_type=event_type, text=text, created_at=datetime.now(timezone.utc))

    assert service.ingest(event("partial-1", "partial", "hel"))[0]
    assert service.ingest(event("partial-2", "partial", "hello"))[0]
    assert service.committed_events("room") == []
    assert service.ingest(event("final-001", "final", "hello"))[0]
    assert service.ingest(event("final-001", "final", "hello"))[1] == "duplicate_event"
    assert len(service.committed_events("room")) == 1


def test_deepgram_disabled_state_is_explicit():
    async def run():
        events = []
        config = SimpleNamespace(deepgram_api_key=None, deepgram_api_url="wss://example.test/v1/listen", asr_model="nova-3", asr_language="en-US", asr_sample_rate=16000, asr_encoding="linear16")
        session = DeepgramASRSession("room", "p1", events.append, config)
        # callbacks are async in production
        session.on_event = lambda event: _append(events, event)
        assert await session.start() == "disabled"
        assert json.loads(events[0].text)["status"] == "disabled"

    asyncio.run(run())


def test_deepgram_result_normalization_keeps_participant_identity():
    class FakeDeepgram:
        def __aiter__(self):
            self.items = iter([
                json.dumps({"channel": {"alternatives": [{"transcript": "hel"}]}, "is_final": False, "start": 0, "duration": 0.4}),
                json.dumps({"channel": {"alternatives": [{"transcript": "hello"}]}, "is_final": True, "start": 0, "duration": 0.8}),
            ])
            return self

        async def __anext__(self):
            try:
                return next(self.items)
            except StopIteration:
                raise StopAsyncIteration

    async def run():
        events = []
        config = SimpleNamespace(deepgram_api_key="secret", deepgram_api_url="wss://example.test/v1/listen", asr_model="nova-3", asr_language="en-US", asr_sample_rate=16000, asr_encoding="linear16")
        session = DeepgramASRSession("room", "participant", _append_events(events), config)
        session.websocket = FakeDeepgram()
        session.started = True
        await session._read_results()
        assert [event.event_type for event in events] == [TranscriptEventType.PARTIAL, TranscriptEventType.FINAL]
        assert all(event.participant_id == "participant" for event in events)
        assert events[-1].end_time == 0.8

    asyncio.run(run())


def test_downstream_payload_is_idempotent_and_final_only():
    from datetime import datetime, timezone
    from Pot.core.downstream import TranscriptDispatcher
    from Pot.schema.audio import TranscriptEvent

    class Response:
        def raise_for_status(self):
            return None

    class Client:
        def __init__(self):
            self.calls = []

        async def post(self, url, **kwargs):
            self.calls.append((url, kwargs))
            return Response()

    config = SimpleNamespace(downstream_api_url="https://processor.invalid/events", downstream_api_key="key", downstream_api_timeout_seconds=2, forward_interim_transcripts=False)
    dispatcher = TranscriptDispatcher(config)
    client = Client()
    dispatcher.client = client
    event = TranscriptEvent(event_id="final-0001", meeting_id="room", participant_id="p1", session_id="asr", sequence_number=1, event_type="final", text="hello", created_at=datetime.now(timezone.utc))
    assert dispatcher.submit(event)
    asyncio.run(dispatcher._deliver(event))
    assert client.calls[0][0] == config.downstream_api_url
    assert client.calls[0][1]["headers"]["Idempotency-Key"] == event.event_id
    assert client.calls[0][1]["json"]["participant_id"] == "p1"


async def _append(events, event):
    events.append(event)


def _append_events(events):
    async def callback(event):
        events.append(event)
    return callback
