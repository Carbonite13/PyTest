# OpenAPI Compatible Endpoint Documentation

## Page Endpoints
endpoitns that are responsible for presenting html pages and appropriate responses

### GET `/about` 
Request: {}
Response: {}
Status Codes: [200,...]
Error Response: {
    "status": "error",
    "message": ""
}

## WebRTC Signaling & Audio Stream Endpoints
See [webrtc.md](./webrtc.md) for full WebRTC signaling documentation including:
- REST endpoints: `/rtc/ice-servers`, `/rtc/rooms`, `/rtc/rooms/{room_id}`
- Audio stream ingestion: `POST /rtc/rooms/{room_id}/peers/{peer_id}/audio`
- Outbound SSE stream: `GET /rtc/rooms/{room_id}/audio-stream`
- WebSocket signaling: `/rtc/ws`
- Debug endpoint: `/debug/rtc`

## Meeting Session Endpoints

| Method   | Path                                              | Description                                       |
|----------|---------------------------------------------------|---------------------------------------------------|
| POST     | `/rtc/sessions`                                   | Create meeting — returns meeting code + session_id |
| GET      | `/rtc/sessions`                                   | List all sessions                                  |
| GET      | `/rtc/sessions/{session_id}`                      | Get session details by ID                          |
| GET      | `/rtc/sessions/by-code/{meeting_code}`            | Resolve human-readable code → session info         |
| DELETE   | `/rtc/sessions/{session_id}`                      | End meeting (host only)                            |
| POST     | `/rtc/sessions/{session_id}/peers/{peer_id}/audio`| Ingest audio chunk for transcription               |
| GET      | `/rtc/sessions/{session_id}/audio-stream`         | SSE stream of live transcription events            |

