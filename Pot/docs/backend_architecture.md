# Backend Architecture

The backend of the Teapot application is built using **FastAPI** and is structured to handle real-time WebRTC signaling, meeting session lifecycle management, privacy controls, and audio stream ingestion.

## Core Services

### 1. `SessionManager` (`Pot/core/session.py`)
Manages the high-level business logic of meeting sessions. It abstracts away the low-level WebRTC networking.
- **State Machine**: Tracks sessions across three states: `WAITING` -> `ACTIVE` -> `ENDED`.
- **Session Metadata**: Stores human-readable meeting codes (e.g. `3K7-AB2-Q9R`), the host's peer ID, and a list of admitted participant IDs.
- **Role**: This is the source of truth for whether a meeting exists, who is allowed in it, and when it terminates.

### 2. `RoomManager` (`Pot/core/room.py`)
Handles the low-level, real-time WebSocket state for WebRTC signaling.
- **Peers & Connections**: Tracks active WebSocket connections (`Peer` objects) and groups them into `Room` objects based on `session_id`.
- **Admission Control**: Enforces privacy. When a peer requests to join a room, they are placed in `waiting_peers`. The `RoomManager` notifies the room's host, and only transitions the peer to active `peers` upon receiving an `admit` signal from the host.
- **Message Relay**: Relays SDP offers/answers and ICE candidates efficiently between connected peers.

### 3. `AudioStreamPipeline` (`Pot/core/audio_pipeline.py`)
Manages real-time audio ingestion and transcription.
- **Chunk Processing**: Receives continuous audio chunks (`audio/webm`) via REST POST from clients.
- **STT Engine**: Wraps a modular Speech-to-Text engine (`SpeechToTextEngine`) for transcribing chunks into text.
- **Session Logging (`SessionTranscriptLogger`)**: Writes transcription logs for each session to an isolated file (`logs/log_audio_{session_id}_{timestamp}_transcript.log`).
- **SSE Broadcasting**: Yields live transcription events via Server-Sent Events (SSE) so external consumers (AI assistants, note takers) can subscribe to the live transcript.

## Separation of Concerns: REST vs WebSockets

The architecture enforces a strict boundary between REST HTTP calls and WebSocket signaling:

- **REST Endpoints (`sessions.py`)**: Used for one-off operations such as creating a session (which allocates a meeting code), ending a session, uploading raw audio chunks, or subscribing to SSE audio streams.
- **WebSocket Route (`signaling.py`)**: Used strictly for rapid, bidirectional WebRTC handshakes (Join requests, Host admission control, SDP/ICE negotiation) and connection state broadcasts (e.g., peer joined/left).

## Privacy & Admission Flow

1. **Host Creates Session**: The host calls `POST /rtc/sessions` via REST. They receive a `session_id` and a `meeting_code`.
2. **Host Joins WS**: The host connects to `/rtc/ws` and sends a `join` signal with the `session_id`. `RoomManager` registers them as the host.
3. **Participant Joins WS**: A participant connects to `/rtc/ws` and sends a `join` signal. `RoomManager` places them in the waiting queue and alerts the host via `join_request_recvd`.
4. **Host Admits**: The host reviews the request and sends an `admit_peer` WebSocket signal.
5. **Sync**: `signaling.py` processes the admit signal, moves the peer from waiting to active in `RoomManager`, syncs the participant list in `SessionManager`, and broadcasts `peer_joined`.
