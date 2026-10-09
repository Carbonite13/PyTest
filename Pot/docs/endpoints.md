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
