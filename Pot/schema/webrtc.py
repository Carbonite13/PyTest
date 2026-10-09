# WebRTC signaling schemas
# Pydantic models for SDP exchange, ICE candidates,
# room lifecycle events, and error responses

from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum

__all__ = [
    "SignalType",
    "SDPPayload",
    "ICECandidatePayload",
    "RoomJoinPayload",
    "RoomLeavePayload",
    "SignalMessage",
    "RoomInfoResponse",
    "ICEServerConfig",
    "PeerEvent",
    "ErrorPayload",
]


class SignalType(str, Enum):
    """Discriminator for WebSocket signaling messages"""
    OFFER = "offer"
    ANSWER = "answer"
    ICE_CANDIDATE = "ice_candidate"
    JOIN = "join"
    LEAVE = "leave"
    PEER_JOINED = "peer_joined"
    PEER_LEFT = "peer_left"
    ERROR = "error"
    ROOM_INFO = "room_info"


class SDPPayload(BaseModel):
    """SDP offer or answer payload"""
    sdp: str = Field(..., description="Session Description Protocol string")
    sdp_type: Literal["offer", "answer"] = Field(..., description="SDP message type")
    target_peer_id: str = Field(..., description="Peer to deliver this SDP to")


class ICECandidatePayload(BaseModel):
    """ICE candidate payload for trickle ICE"""
    candidate: str = Field(..., description="ICE candidate string")
    sdp_mid: Optional[str] = Field(None, description="Media stream identification tag")
    sdp_mline_index: Optional[int] = Field(None, description="Media description index")
    target_peer_id: str = Field(..., description="Peer to deliver this candidate to")


class RoomJoinPayload(BaseModel):
    """Payload sent when a peer wants to join a room"""
    room_id: str = Field(..., min_length=1, max_length=64, description="Room identifier")
    display_name: Optional[str] = Field(None, max_length=128, description="Human-readable peer name")


class RoomLeavePayload(BaseModel):
    """Payload sent when a peer leaves a room"""
    room_id: str = Field(..., description="Room identifier")


class PeerEvent(BaseModel):
    """Notification sent to peers when someone joins or leaves"""
    peer_id: str = Field(..., description="The peer that triggered the event")
    display_name: Optional[str] = Field(None, description="Human-readable peer name")
    room_id: str = Field(..., description="Room the event occurred in")


class ErrorPayload(BaseModel):
    """Error response sent over the signaling channel"""
    code: int = Field(..., description="Application-level error code")
    message: str = Field(..., description="Human-readable error description")


class SignalMessage(BaseModel):
    """
    Top-level envelope for all signaling messages.
    The `type` field determines which payload field is populated.
    """
    type: SignalType = Field(..., description="Message type discriminator")
    sdp: Optional[SDPPayload] = Field(None, description="SDP offer/answer payload")
    ice: Optional[ICECandidatePayload] = Field(None, description="ICE candidate payload")
    join: Optional[RoomJoinPayload] = Field(None, description="Room join payload")
    leave: Optional[RoomLeavePayload] = Field(None, description="Room leave payload")
    peer_event: Optional[PeerEvent] = Field(None, description="Peer lifecycle event")
    error: Optional[ErrorPayload] = Field(None, description="Error payload")


class ICEServerConfig(BaseModel):
    """ICE server configuration returned to clients"""
    urls: list[str] = Field(..., description="STUN/TURN server URLs")
    username: Optional[str] = Field(None, description="TURN username (if applicable)")
    credential: Optional[str] = Field(None, description="TURN credential (if applicable)")


class RoomInfoResponse(BaseModel):
    """REST response containing room metadata"""
    room_id: str = Field(..., description="Room identifier")
    peer_count: int = Field(..., description="Number of connected peers")
    peers: list[dict] = Field(default_factory=list, description="List of peer info dicts")
    ice_servers: list[ICEServerConfig] = Field(
        default_factory=list, description="ICE server configurations for this session"
    )
