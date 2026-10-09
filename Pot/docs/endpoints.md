# Meeting endpoints

## REST

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/rtc/sessions` | Create a meeting; returns `session`, `meeting_code`, and a private `host_token`. |
| `GET` | `/health` | Confirm that the FastAPI backend is reachable. |
| `GET` | `/rtc/sessions/by-code/{meeting_code}` | Resolve a live meeting code; returns `410` after termination. |
| `GET` | `/rtc/sessions/{session_id}` | Read lifecycle metadata. |
| `DELETE` | `/rtc/sessions/{session_id}` | End a meeting with `{ "peer_id": "...", "host_token": "..." }`; host only. |
| `GET` | `/rtc/rooms` | Development room diagnostics. |
`/rtc/ws` is the authenticated room, audio, and transcript transport.

## WebSocket `/rtc/ws`

The server sends `connected` with a random server-assigned participant ID.
Control messages are:

```json
{"type":"room.join","join":{"room_id":"...","meeting_code":"ABC-123-XYZ","display_name":"Ada","host_token":"..."}}
{"type":"audio.start"}
{"type":"audio.mute"}
{"type":"audio.unmute"}
{"type":"audio.stop"}
{"type":"room.leave","room_id":"..."}
{"type":"ping"}
```

After `audio.start`, the client sends binary 640-byte PCM16 frames. The server
queues an `audio.frame` metadata event immediately before each binary payload
for every other participant. The metadata identifies the authenticated source;
client-supplied participant IDs are ignored.

Errors are sent as `{ "type": "error", "code", "message" }`. `413` is an
oversized control message, `422` is a malformed audio frame, `429` indicates a
slow recipient, and `410` means the meeting has ended.
