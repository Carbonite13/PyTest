# WebRTC Signaling — Endpoint Documentation

## REST Endpoints
HTTP endpoints for WebRTC config and Session lifecycle. See `endpoints.md` for a complete list.

### GET `/rtc/ice-servers`
Request: {}
Response: {
    "ice_servers": [
        {
            "urls": ["stun:stun.l.google.com:19302"],
            "username": null,
            "credential": null
        }
    ]
}
Status Codes: [200]
Error Response: {
    "status": "error",
    "message": ""
}

### GET `/rtc/sessions`
Request: {}
Response: {
    "count": 1,
    "sessions": [
        {
            "session_id": "abc123def456",
            "meeting_code": "3K7-AB2-Q9R",
            "host_peer_id": "a1b2c3d4e5f6",
            "host_display_name": "Alice",
            "status": "active",
            "participant_count": 2,
            "created_at": "...",
            "started_at": "...",
            "ended_at": null
        }
    ]
}
Status Codes: [200]

### GET `/rtc/sessions/{session_id}`
Returns similar structure for a specific session. Status Codes: [200, 404]

### GET `/rtc/sessions/by-code/{meeting_code}`
Resolves a human-readable meeting code to a session. Status Codes: [200, 404, 410 (Ended)]

## WebSocket Signaling Endpoint
Real-time signaling channel for WebRTC peer-to-peer connection negotiation.

### WS `/rtc/ws`
Connection: WebSocket upgrade at ws://<host>:<port>/rtc/ws

#### Connection Flow
1. Client connects via WebSocket
2. Server accepts and sends a `welcome` message containing the assigned `peer_id`
3. Client sends a `join` message to enter a room
4. Server responds with `room_info` (existing peers + ICE config)
5. Server broadcasts `peer_joined` to other room members
6. Clients exchange `offer`, `answer`, and `ice_candidate` messages through the server relay
7. On disconnect, server broadcasts `peer_left` to remaining peers

#### Server → Client: welcome
Sent immediately after connection is accepted.
```json
{
    "type": "welcome",
    "peer_id": "a1b2c3d4e5f6"
}
```

#### Client → Server: join
```json
{
    "type": "join",
    "join": {
        "room_id": "my-meeting",
        "display_name": "Alice"
    }
}
```

#### Server → Client: room_info
Sent to the joining peer after a successful join.
```json
{
    "type": "room_info",
    "room_id": "my-meeting",
    "peers": [
        {"peer_id": "f6e5d4c3b2a1", "display_name": "Bob"}
    ],
    "ice_servers": [
        {"urls": ["stun:stun.l.google.com:19302"], "username": null, "credential": null}
    ]
}
```

#### Server → Room: peer_joined
Broadcast to existing room members when a new peer joins.
```json
{
    "type": "peer_joined",
    "peer_event": {
        "peer_id": "a1b2c3d4e5f6",
        "display_name": "Alice",
        "room_id": "my-meeting"
    }
}
```

#### Client → Server: offer
```json
{
    "type": "offer",
    "sdp": {
        "sdp": "v=0\r\no=- 12345 ...",
        "sdp_type": "offer",
        "target_peer_id": "f6e5d4c3b2a1"
    }
}
```

#### Client → Server: answer
```json
{
    "type": "answer",
    "sdp": {
        "sdp": "v=0\r\no=- 67890 ...",
        "sdp_type": "answer",
        "target_peer_id": "a1b2c3d4e5f6"
    }
}
```

#### Client → Server: ice_candidate
```json
{
    "type": "ice_candidate",
    "ice": {
        "candidate": "candidate:842163049 1 udp ...",
        "sdp_mid": "0",
        "sdp_mline_index": 0,
        "target_peer_id": "f6e5d4c3b2a1"
    }
}
```

#### Server → Client: Relayed offer/answer/ice_candidate
The server relays SDP and ICE messages to the target peer with an added `from_peer_id` field.
```json
{
    "type": "offer",
    "sdp": {
        "sdp": "v=0\r\no=- 12345 ...",
        "sdp_type": "offer",
        "target_peer_id": "f6e5d4c3b2a1"
    },
    "from_peer_id": "a1b2c3d4e5f6"
}
```

#### Client → Server: leave
```json
{
    "type": "leave",
    "leave": {
        "room_id": "my-meeting"
    }
}
```

#### Server → Room: peer_left
Broadcast when a peer leaves or disconnects.
```json
{
    "type": "peer_left",
    "peer_event": {
        "peer_id": "a1b2c3d4e5f6",
        "display_name": "Alice",
        "room_id": "my-meeting"
    }
}
```

#### Server → Client: error
Sent when the server cannot process a message.
```json
{
    "type": "error",
    "error": {
        "code": 400,
        "message": "Missing 'sdp' payload"
    }
}
```

## Error Codes
| Code | Meaning |
|------|---------|
| 400  | Malformed message or missing required payload |
| 404  | Target peer or room not found |

## Debug Endpoint

### GET `/debug/rtc`
Request: {}
Response: {
    "stun_server": "stun:stun.l.google.com:19302",
    "turn_server": "[+]" or "[-]",
    "turn_username": "[+]" or "[-]",
    "turn_credential": "[+]" or "[-]"
}
Status Codes: [200]
Error Response: {
    "status": "error",
    "message": ""
}

---

## Session Privacy & Host Admission Control

### Session Host Allocation
- The first peer joining a room becomes the **Meeting Host** (`host_peer_id`).
- When a new peer attempts to join an existing room, they are placed in a **Waiting Room** queue.

### Admission Signals

#### Server → Host: `join_request_recvd`
Sent to the host when a peer is waiting to join.
```json
{
    "type": "join_request_recvd",
    "peer_event": {
        "peer_id": "f6e5d4c3b2a1",
        "display_name": "Bob",
        "room_id": "abc123def456"
    }
}
```

#### Host → Server: `admit_peer`
Host approves entry for a waiting peer.
```json
{
    "type": "admit_peer",
    "admission": {
        "target_peer_id": "f6e5d4c3b2a1",
        "room_id": "abc123def456"
    }
}
```

#### Host → Server: `reject_peer`
Host denies entry for a waiting peer.
```json
{
    "type": "reject_peer",
    "admission": {
        "target_peer_id": "f6e5d4c3b2a1",
        "room_id": "abc123def456"
    }
}
```

#### Server → Client: `join_rejected`
Sent to the waiting peer if the host rejects them.
```json
{
    "type": "join_rejected",
    "room_id": "abc123def456",
    "message": "Host rejected your request to join the meeting."
}
```

#### Server → Room: `session_ended`
Broadcast when the host explicitly calls the REST `DELETE /rtc/sessions/{session_id}` endpoint.
```json
{
    "type": "session_ended",
    "session_id": "abc123def456",
    "ended_by": "a1b2c3d4e5f6",
    "message": "The meeting host has ended this session."
}
```

---

## Audio Stream Ingestion & Session-Based Transcription Logging

### Speech-to-Text Processing Pipeline ([`Pot/core/audio_pipeline.py`](file:///home/datura/Desktop/PyTest/Pot/core/audio_pipeline.py))
- **`SpeechToTextEngine`**: Modular STT processor converting raw audio frames (`audio/webm`) into structured transcript entries.
- **`SessionTranscriptLogger`**: Session-level file logger. Creates and appends transcripts to a single meeting log file:
  `log_audio_[session_id]_[time]_transcript.log` (e.g. `logs/log_audio_abc123def456_20261009_223334_transcript.log`).
- **REST Ingestion**: Clients push chunks to `POST /rtc/sessions/{session_id}/peers/{peer_id}/audio`.
- **Live Stream (SSE)**: Broadcasts transcribed speech events out to external API subscribers on `GET /rtc/sessions/{session_id}/audio-stream`.
