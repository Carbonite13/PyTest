/**
 * WebRTC Client Module (Teapot WebRTC Frontend Implementation)
 * Handles WebSocket signaling, PeerConnection creation, SDP offer/answer relay,
 * ICE candidate exchange, and local audio/video media stream control.
 */

import { API_CONFIG } from './constants.js';

export class WebRTCClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || API_CONFIG.BASE_URL || window.location.origin;
    this.peerId = null;
    this.roomId = null;
    this.ws = null;
    this.peers = new Map(); // peerId -> { connection: RTCPeerConnection, stream: MediaStream }
    this.localStream = null;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.audioMuted = false;
    this.videoMuted = false;

    // Callbacks for UI updates
    this.onPeerJoined = options.onPeerJoined || (() => {});
    this.onPeerLeft = options.onPeerLeft || (() => {});
    this.onRemoteTrack = options.onRemoteTrack || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || (() => {});
    
    // Admission control callbacks
    this.onWaitingForHost = options.onWaitingForHost || (() => {});
    this.onJoinRequest = options.onJoinRequest || (() => {});
    this.onJoinRejected = options.onJoinRejected || (() => {});
    this.onSessionEnded = options.onSessionEnded || (() => {});
    this.onRoomInfo = options.onRoomInfo || (() => {});
  }

  /**
   * Fetch ICE Server configuration from backend
   */
  async fetchIceServers() {
    try {
      const res = await fetch(`${this.baseUrl}/rtc/ice-servers`);
      if (res.ok) {
        const data = await res.json();
        if (data.ice_servers && data.ice_servers.length > 0) {
          this.iceServers = data.ice_servers;
          console.log('[WebRTC] Fetched ICE servers:', this.iceServers);
        }
      }
    } catch (err) {
      console.warn('[WebRTC] Could not fetch ICE servers from backend, using default STUN:', err);
    }
  }

  /**
   * Request local microphone and camera media streams and initialize audio chunk streaming
   */
  async startLocalStream(constraints = { audio: true, video: true }) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC] Acquired local media stream');

      // Setup audio streaming to backend for live transcription pipeline
      this.startAudioIngestion();

      return this.localStream;
    } catch (err) {
      console.error('[WebRTC] Error acquiring local media stream:', err);
      this.onError('Unable to access camera or microphone: ' + err.message);
      throw err;
    }
  }

  /**
   * Start MediaRecorder to capture audio chunks and stream them to backend REST API
   */
  startAudioIngestion() {
    if (!this.localStream) return;

    try {
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const audioOnlyStream = new MediaStream(audioTracks);
      this.mediaRecorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm' });

      this.mediaRecorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0 && this.roomId && this.peerId) {
          try {
            const url = `${this.baseUrl}/rtc/sessions/${this.roomId}/peers/${this.peerId}/audio`;
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'audio/webm' },
              body: event.data
            });
            console.log('[WebRTC] Audio chunk streamed to backend pipeline successfully');
          } catch (err) {
            console.warn('[WebRTC] Audio chunk streaming error:', err);
          }
        }
      };

      // Slice audio stream every 3000ms (3 seconds)
      this.mediaRecorder.start(3000);
      console.log('[WebRTC] Audio ingestion pipeline started');
    } catch (err) {
      console.warn('[WebRTC] Could not start MediaRecorder for audio streaming:', err);
    }
  }

  /**
   * Connect to the WebRTC signaling WebSocket server
   */
  async connectSignaling() {
    await this.fetchIceServers();

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsHost = window.location.host;
    if (this.baseUrl.startsWith('http')) {
      const url = new URL(this.baseUrl);
      wsHost = url.host;
    }
    const wsUrl = `${wsProtocol}//${wsHost}/rtc/ws`;

    console.log('[WebRTC] Connecting to signaling WebSocket:', wsUrl);
    this.onStatusChange('Connecting to signaling server...');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebRTC] Signaling WebSocket connected');
        this.onStatusChange('Connected to signaling server');
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          await this.handleSignalingMessage(msg);
          if (msg.type === 'welcome') {
            this.peerId = msg.peer_id;
            resolve(this.peerId);
          }
        } catch (err) {
          console.error('[WebRTC] Error parsing signaling message:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WebRTC] WebSocket error:', err);
        this.onStatusChange('Signaling error occurred');
        this.onError('Signaling connection error');
        reject(err);
      };

      this.ws.onclose = () => {
        console.log('[WebRTC] Signaling WebSocket closed');
        this.onStatusChange('Disconnected');
      };
    });
  }

  /**
   * Join a specific room
   */
  joinRoom(roomId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Signaling WebSocket is not connected');
    }
    this.roomId = roomId;
    this.ws.send(JSON.stringify({
      type: 'join',
      room_id: roomId
    }));
    console.log(`[WebRTC] Joined room '${roomId}'`);
    this.onStatusChange(`Joined room ${roomId}`);
  }

  /**
   * Admit a waiting peer
   */
  admitPeer(targetId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'admit_peer',
        admission: {
          target_peer_id: targetId,
          room_id: this.roomId
        }
      }));
    }
  }

  /**
   * Reject a waiting peer
   */
  rejectPeer(targetId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'reject_peer',
        admission: {
          target_peer_id: targetId,
          room_id: this.roomId
        }
      }));
    }
  }

  /**
   * Handle incoming WebSocket messages from the signaling server
   */
  async handleSignalingMessage(msg) {
    console.log('[WebRTC] Received signal:', msg.type, msg);

    switch (msg.type) {
      case 'welcome':
        console.log(`[WebRTC] Registered as Peer ID: ${msg.peer_id}`);
        break;

      case 'waiting_for_host':
        console.log('[WebRTC] Waiting for host to admit');
        this.onStatusChange('Waiting for host admission...');
        this.onWaitingForHost();
        break;

      case 'join_request_recvd':
        console.log(`[WebRTC] Join request from ${msg.peer_event.peer_id}`);
        this.onJoinRequest(msg.peer_event);
        break;

      case 'join_rejected':
        console.log(`[WebRTC] Join rejected: ${msg.message}`);
        this.onStatusChange('Join request rejected by host');
        this.onJoinRejected(msg.message);
        break;

      case 'room_info':
        console.log(`[WebRTC] Joined room successfully`);
        this.onStatusChange('Connected to room');
        this.onRoomInfo(msg);
        break;

      case 'session_ended':
        console.log(`[WebRTC] Session ended by host`);
        this.onStatusChange('Session ended by host');
        this.onSessionEnded(msg.message);
        break;

      case 'peer_joined':
        console.log(`[WebRTC] Peer joined room: ${msg.peer_id}`);
        this.onPeerJoined(msg.peer_id);
        // Initiate offer to newly joined peer
        await this.createPeerConnection(msg.peer_id, true);
        break;

      case 'peer_left':
        console.log(`[WebRTC] Peer left room: ${msg.peer_id}`);
        this.removePeer(msg.peer_id);
        this.onPeerLeft(msg.peer_id);
        break;

      case 'offer':
        console.log(`[WebRTC] Received offer from ${msg.sender_id}`);
        await this.handleOffer(msg.sender_id, msg.sdp);
        break;

      case 'answer':
        console.log(`[WebRTC] Received answer from ${msg.sender_id}`);
        await this.handleAnswer(msg.sender_id, msg.sdp);
        break;

      case 'ice_candidate':
        console.log(`[WebRTC] Received ICE candidate from ${msg.sender_id}`);
        await this.handleIceCandidate(msg.sender_id, msg.candidate);
        break;

      case 'error':
        console.error(`[WebRTC] Server error: ${msg.message}`);
        this.onError(msg.message);
        break;

      default:
        console.warn(`[WebRTC] Unknown message type: ${msg.type}`);
    }
  }

  /**
   * Create RTCPeerConnection for a remote peer
   */
  async createPeerConnection(remotePeerId, isInitiator = false) {
    if (this.peers.has(remotePeerId)) {
      return this.peers.get(remotePeerId).connection;
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peerObj = { connection: pc, stream: new MediaStream() };
    this.peers.set(remotePeerId, peerObj);

    // Add local stream tracks to connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE Candidate trickle handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(JSON.stringify({
          type: 'ice_candidate',
          target_id: remotePeerId,
          candidate: event.candidate.toJSON()
        }));
      }
    };

    // Receive remote stream tracks
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track from ${remotePeerId}:`, event.track.kind);
      event.streams[0].getTracks().forEach((track) => {
        peerObj.stream.addTrack(track);
      });
      this.onRemoteTrack(remotePeerId, peerObj.stream);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${remotePeerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(remotePeerId);
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.ws.send(JSON.stringify({
        type: 'offer',
        target_id: remotePeerId,
        sdp: offer.sdp
      }));
    }

    return pc;
  }

  /**
   * Handle incoming SDP offer
   */
  async handleOffer(remotePeerId, sdp) {
    const pc = await this.createPeerConnection(remotePeerId, false);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.ws.send(JSON.stringify({
      type: 'answer',
      target_id: remotePeerId,
      sdp: answer.sdp
    }));
  }

  /**
   * Handle incoming SDP answer
   */
  async handleAnswer(remotePeerId, sdp) {
    const peerObj = this.peers.get(remotePeerId);
    if (peerObj) {
      await peerObj.connection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    }
  }

  /**
   * Handle incoming ICE candidate
   */
  async handleIceCandidate(remotePeerId, candidate) {
    const peerObj = this.peers.get(remotePeerId);
    if (peerObj && candidate) {
      await peerObj.connection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  /**
   * Toggle local Audio (mute/unmute)
   */
  toggleAudio() {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.audioMuted = !audioTrack.enabled;
      return this.audioMuted;
    }
    return false;
  }

  /**
   * Toggle local Video (enable/disable camera)
   */
  toggleVideo() {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.videoMuted = !videoTrack.enabled;
      return this.videoMuted;
    }
    return false;
  }

  /**
   * Remove peer connection and cleanup stream
   */
  removePeer(remotePeerId) {
    const peerObj = this.peers.get(remotePeerId);
    if (peerObj) {
      peerObj.connection.close();
      this.peers.delete(remotePeerId);
    }
  }

  /**
   * Leave room and close all peer connections
   */
  leaveRoom() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roomId) {
      this.ws.send(JSON.stringify({
        type: 'leave',
        room_id: this.roomId
      }));
    }
    this.peers.forEach((peerObj, peerId) => this.removePeer(peerId));
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.roomId = null;
    this.onStatusChange('Left room');
  }

  /**
   * Close WebRTC client completely
   */
  disconnect() {
    this.leaveRoom();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
