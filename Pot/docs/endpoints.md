# Meeting endpoints

## REST

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/rtc/sessions` | Create a meeting; returns `session`, `meeting_code`, and a private `host_token`. |
| `GET` | `/rtc/sessions/by-code/{meeting_code}` | Resolve a live meeting code; returns `410` after termination. |
| `GET` | `/rtc/sessions/{session_id}` | Read lifecycle metadata. |
| `DELETE` | `/rtc/sessions/{session_id}` | End a meeting with `{ "peer_id": "...", "host_token": "..." }`; host only. |
| `GET` | `/rtc/ice-servers` | Return configured STUN/TURN servers. |
| `GET` | `/rtc/rooms` | Development room diagnostics. |
| `GET` | `/rtc/sessions/{session_id}/transcript-stream?peer_id=...` | Authenticated text-event SSE compatibility stream. |

`POST /rtc/sessions/{id}/peers/{peer}/audio` is retained only as an explicit
compatibility response and returns `410 Gone`; raw audio is not accepted.

## WebSocket `/rtc/ws`

The server sends `welcome` with a random `peer_id`. Messages use nested
payloads:

```json
{"type":"join","join":{"room_id":"...","display_name":"Ada","host_token":"..."}}
{"type":"offer","sdp":{"sdp":"...","sdp_type":"offer","target_peer_id":"..."}}
{"type":"answer","sdp":{"sdp":"...","sdp_type":"answer","target_peer_id":"..."}}
{"type":"ice_candidate","ice":{"candidate":"...","sdp_mid":"0","sdp_mline_index":0,"target_peer_id":"..."}}
{"type":"leave","leave":{"room_id":"..."}}
{"type":"transcript","transcript":{"event_id":"event-0001","meeting_id":"...","participant_id":"...","session_id":"...","sequence_number":0,"event_type":"final","text":"Hello","start_time":null,"end_time":null,"created_at":"2026-01-01T00:00:00Z","protocol_version":"1"}}
```

SDP/ICE is relayed only if both peers are admitted to the sender's current
room. ICE arriving before a remote description is queued by the browser and
flushed after `setRemoteDescription`.

Errors are sent as `{ "type": "error", "error": { "code", "message" } }`.
`400` is malformed input, `403` is an unauthorized room/participant action,
`404` is an unknown meeting/peer, `409` is a duplicate transcript event, and
`410` means the meeting has ended.
