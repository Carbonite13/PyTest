# Frontend UI Integration Documentation (`Tea/`)

This document outlines the WebRTC client implementation added to `Tea/`, how the video conferencing interface components operate, and recommended future UI enhancements.

---

## 1. Implemented Features & Architecture

### A. WebRTC Client Engine (`Tea/js/modules/webrtcClient.js`)
- **Class**: `WebRTCClient`
- **Signaling Connection**: Connects to FastAPI WebSocket signaling server (`ws://<host>:<port>/rtc/ws`).
- **ICE Server Auto-Discovery**: Fetches configured STUN/TURN server list from `/rtc/ice-servers`.
- **Peer Connection Lifecycle**:
  - Automatically handles `welcome`, `peer_joined`, `peer_left`, `offer`, `answer`, and `ice_candidate` message types.
  - Dynamically creates `RTCPeerConnection` for each remote participant.
  - Handles SDP offer/answer exchanges and trickle ICE candidate forwarding.
- **Media Controls**:
  - `startLocalStream()`: Requests `getUserMedia` audio & video permissions.
  - `toggleAudio()`: Mutes/unmutes local microphone.
  - `toggleVideo()`: Enables/disables local camera track.
  - `leaveRoom()` / `disconnect()`: Closes peer connections and releases local media device handles.

### B. Video Conferencing UI Components (`Tea/index.html` & `Tea/js/main.js`)
- **Room Join Form**: Located in *Around the Globe* view (`#webrtcJoinCard`). Users enter a room ID (e.g., `room-101`) to connect.
- **Active Video Grid** (`#videoConferenceInterface`):
  - Displays local camera stream tile (`#localVideoTile`).
  - Dynamically creates & appends remote peer video tiles (`.remote-video-tile`) upon receiving remote media tracks.
- **Meeting Control Bar**:
  - **Mute Audio Button** (`#toggleAudioBtn`): Toggles mic with warning color indicator.
  - **Mute Video Button** (`#toggleVideoBtn`): Toggles camera with warning color indicator.
  - **Leave Call Button** (`#leaveCallBtn`): Ends meeting, disconnects WebSocket, stops media tracks, and resets view to room join state.

---

## 2. Outstanding UI Tasks & Next Steps for Frontend (`Tea/`)

To further enhance the UI in `Tea/`:

1. **Screen Sharing Integration**:
   - Add a screen-share button to `#conferenceControls`.
   - Call `navigator.mediaDevices.getDisplayMedia()` and replace video track via `RTCRtpSender.replaceTrack()`.

2. **In-Call Text Chat & Real-Time Transcript Panel**:
   - Add a side drawer / collapsible panel for textual messaging.
   - Utilize WebRTC `RTCDataChannel` or WebSocket chat relay.

3. **Active Speaker Highlight & Dynamic Grid Layout**:
   - Calculate audio energy level with `AudioContext` and add active speaker border highlighting to video tiles.

4. **Participant List Drawer**:
   - Expand `#webrtcPeerCountBadge` into an interactive drawer showing participant names, roles, and individual volume indicators.
