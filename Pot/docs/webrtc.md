# WebRTC Signaling — Endpoint Documentation

## REST Endpoints
HTTP endpoints for room discovery and ICE server configuration.

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

### GET `/rtc/rooms`
Request: {}
Response: {
    "rooms": [
        {
            "room_id": "my-meeting",
            "peer_count": 2,
            "peers": [
                {"peer_id": "a1b2c3d4e5f6", "display_name": "Alice"},
                {"peer_id": "f6e5d4c3b2a1", "display_name": "Bob"}
            ]
        }
    ]
}
Status Codes: [200]
Error Response: {
    "status": "error",
    "message": ""
}

### GET `/rtc/rooms/{room_id}`
Request: {}
Response: {
    "room_id": "my-meeting",
    "peer_count": 2,
    "peers": [
        {"peer_id": "a1b2c3d4e5f6", "display_name": "Alice"}
    ],
    "ice_servers": [
        {"urls": ["stun:stun.l.google.com:19302"], "username": null, "credential": null}
    ]
}
Status Codes: [200, 404]
Error Response: {
    "status": "error",
    "message": "Room 'xyz' not found"
}

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
- The server sends a `waiting_for_host` signal to the joining peer and a `join_request_recvd` signal to the Host.

### Host Controls
- **`admit_peer`**: Host sends an `admit_peer` signal with `target_peer_id` to approve entry. The admitted peer receives `room_info` and joins WebRTC signaling.
- **`reject_peer`**: Host sends a `reject_peer` signal to deny entry. The waiting peer receives `join_rejected`.

---

## Audio Stream Ingestion & Session-Based Transcription Logging

### Speech-to-Text Processing Pipeline ([`Pot/core/audio_pipeline.py`](file:///home/datura/Desktop/PyTest/Pot/core/audio_pipeline.py))
- **`SpeechToTextEngine`**: Modular STT processor converting raw audio frames (`audio/webm`) into structured transcript entries.
- **`SessionTranscriptLogger`**: Session-level file logger. Creates and appends transcripts to a single meeting log file:
  `log_audio_[room_id]_[time]_transcript.log` (e.g. `logs/log_audio_session-101_20261009_223334_transcript.log`).
- **Live Stream (SSE)**: Broadcasts transcribed speech events out to external API subscribers on `GET /rtc/rooms/{room_id}/audio-stream`.
