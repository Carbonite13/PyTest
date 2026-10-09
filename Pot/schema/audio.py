"""Wire contracts for the centralized audio-room WebSocket."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ControlType(str, Enum):
    ROOM_JOIN = "room.join"
    ROOM_LEAVE = "room.leave"
    AUDIO_START = "audio.start"
    AUDIO_STOP = "audio.stop"
    AUDIO_MUTE = "audio.mute"
    AUDIO_UNMUTE = "audio.unmute"
    PING = "ping"


class JoinPayload(BaseModel):
    room_id: str = Field(..., min_length=20, max_length=128)
    meeting_code: str = Field(..., min_length=9, max_length=11)
    display_name: Optional[str] = Field(None, max_length=128)
    host_token: Optional[str] = Field(None, min_length=16, max_length=256)


class ControlMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ControlType
    join: Optional[JoinPayload] = None
    room_id: Optional[str] = Field(None, min_length=20, max_length=128)


class TranscriptEventType(str, Enum):
    PARTIAL = "partial"
    FINAL = "final"
    STATUS = "status"
    ERROR = "error"


class TranscriptEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(..., min_length=8, max_length=128)
    meeting_id: str = Field(..., min_length=1, max_length=128)
    participant_id: str = Field(..., min_length=1, max_length=128)
    session_id: str = Field(..., min_length=1, max_length=128)
    sequence_number: int = Field(..., ge=0)
    event_type: TranscriptEventType
    text: Optional[str] = Field(None, max_length=4000)
    start_time: Optional[float] = Field(None, ge=0)
    end_time: Optional[float] = Field(None, ge=0)
    created_at: datetime
    protocol_version: Literal["1"] = "1"

    @field_validator("created_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at must include a timezone")
        return value


def audio_frame_metadata(participant_id: str, sequence_number: int, timestamp_ms: int, sample_count: int) -> dict:
    return {
        "type": "audio.frame",
        "participant_id": participant_id,
        "sequence_number": sequence_number,
        "timestamp_ms": timestamp_ms,
        "sample_rate": 16000,
        "channels": 1,
        "sample_format": "s16le",
        "sample_count": sample_count,
    }
