"""Authenticated transcript event aggregation.

Audio never enters this service.  Participants run ASR locally and submit
small, versioned transcript events over their authenticated signaling socket.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from typing import AsyncGenerator

from Pot.schema.webrtc import TranscriptEvent, TranscriptEventType


@dataclass
class _MeetingTranscript:
    events: dict[str, TranscriptEvent] = field(default_factory=dict)
    final_event_ids: set[str] = field(default_factory=set)
    final_by_source: dict[tuple[str, str, int], str] = field(default_factory=dict)
    partial_by_source: dict[tuple[str, str, int], str] = field(default_factory=dict)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    accepted_by_participant: dict[str, int] = field(default_factory=lambda: defaultdict(int))


class TranscriptService:
    """Bounded, in-process transcript fan-out for the single-worker MVP."""

    MAX_EVENTS_PER_MEETING = 10_000
    MAX_SUBSCRIBER_QUEUE = 256
    MAX_EVENTS_PER_PARTICIPANT = 2_000

    def __init__(self):
        self._meetings: dict[str, _MeetingTranscript] = {}

    def _meeting(self, meeting_id: str) -> _MeetingTranscript:
        return self._meetings.setdefault(meeting_id, _MeetingTranscript())

    def ingest(self, event: TranscriptEvent) -> tuple[bool, str]:
        """Store/deliver an event; return ``(accepted, reason)``.

        Final events are deduplicated by ``event_id``.  A partial event only
        replaces the current value for its participant/session/sequence key and
        is not retained as a committed transcript segment.
        """
        meeting = self._meeting(event.meeting_id)
        if event.event_id in meeting.events:
            return False, "duplicate_event"
        if event.end_time is not None and event.start_time is not None and event.end_time < event.start_time:
            return False, "invalid_timing"
        if event.event_type in {TranscriptEventType.PARTIAL, TranscriptEventType.FINAL} and not (event.text or "").strip():
            return False, "text_required"
        source = (event.participant_id, event.session_id, event.sequence_number)
        if event.event_type == TranscriptEventType.FINAL and source in meeting.final_by_source:
            return False, "duplicate_final_sequence"
        if event.event_type == TranscriptEventType.PARTIAL and source in meeting.final_by_source:
            return False, "final_already_committed"
        if len(meeting.events) >= self.MAX_EVENTS_PER_MEETING:
            return False, "meeting_event_limit"
        if meeting.accepted_by_participant[event.participant_id] >= self.MAX_EVENTS_PER_PARTICIPANT:
            return False, "participant_event_limit"

        if event.event_type == TranscriptEventType.PARTIAL:
            old_id = meeting.partial_by_source.get(source)
            if old_id:
                meeting.events.pop(old_id, None)
            meeting.partial_by_source[source] = event.event_id
        elif event.event_type == TranscriptEventType.FINAL:
            old_partial = meeting.partial_by_source.pop(source, None)
            if old_partial:
                meeting.events.pop(old_partial, None)
            meeting.final_event_ids.add(event.event_id)
            meeting.final_by_source[source] = event.event_id

        meeting.events[event.event_id] = event
        meeting.accepted_by_participant[event.participant_id] += 1
        payload = event.model_dump(mode="json")
        for queue in list(meeting.subscribers):
            if queue.full():
                # Drop oldest live events for a slow subscriber; never grow
                # memory without bound or block the meeting transport.
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(payload)
        return True, "accepted"

    async def subscribe(self, meeting_id: str) -> AsyncGenerator[dict, None]:
        meeting = self._meeting(meeting_id)
        queue: asyncio.Queue = asyncio.Queue(maxsize=self.MAX_SUBSCRIBER_QUEUE)
        meeting.subscribers.add(queue)
        try:
            while True:
                event = await queue.get()
                if event is None:
                    return
                yield event
        finally:
            meeting.subscribers.discard(queue)

    def clear_meeting(self, meeting_id: str) -> None:
        meeting = self._meetings.pop(meeting_id, None)
        if meeting:
            for queue in meeting.subscribers:
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)

    def committed_events(self, meeting_id: str) -> list[dict]:
        meeting = self._meetings.get(meeting_id)
        if not meeting:
            return []
        finals = [event for event in meeting.events.values() if event.event_type == TranscriptEventType.FINAL]
        finals.sort(key=lambda event: (event.participant_id, event.session_id, event.sequence_number, event.created_at))
        return [event.model_dump(mode="json") for event in finals]


transcript_service = TranscriptService()
