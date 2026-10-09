/**
 * P2P WebRTC client.
 *
 * FastAPI is a signaling relay only: media tracks flow between browser
 * RTCPeerConnections.  Signaling and transcript events use the authenticated
 * room WebSocket, while transcription itself is delegated to an optional
 * client-side adapter.
 */

import { API_CONFIG } from './constants.js';
import { TranscriptionSession } from './transcription.js';

export class WebRTCClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || API_CONFIG.BASE_URL || window.location.origin;
    this.peerId = null;
    this.roomId = null;
    this.hostToken = null;
    this.displayName = options.displayName || null;
    this.ws = null;
    this.connectPromise = null;
    this.closing = false;
    this.peers = new Map();
    this.pendingIceCandidates = new Map();
    this.localStream = null;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.audioMuted = false;
    this.videoMuted = false;
    this.transcriptionAdapter = options.transcriptionAdapter || null;
    this.transcription = null;
    this.transcriptQueue = [];
    this.maxTranscriptQueue = 128;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;

    this.onPeerJoined = options.onPeerJoined || (() => {});
    this.onPeerLeft = options.onPeerLeft || (() => {});
    this.onRemoteTrack = options.onRemoteTrack || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onWaitingForHost = options.onWaitingForHost || (() => {});
    this.onJoinRequest = options.onJoinRequest || (() => {});
    this.onJoinRejected = options.onJoinRejected || (() => {});
    this.onSessionEnded = options.onSessionEnded || (() => {});
    this.onRoomInfo = options.onRoomInfo || (() => {});
  }

  async fetchIceServers() {
    try {
      const response = await fetch(`${this.baseUrl}/rtc/ice-servers`);
      if (!response.ok) throw new Error(`ICE configuration request failed (${response.status})`);
      const data = await response.json();
      if (Array.isArray(data.ice_servers) && data.ice_servers.length) this.iceServers = data.ice_servers;
    } catch (error) {
      console.warn('[WebRTC] Falling back to default STUN configuration:', error);
    }
  }

  async startLocalStream(constraints = { audio: true, video: true }) {
    if (!constraints.audio && !constraints.video) {
      this.localStream = new MediaStream();
      return this.localStream;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not provide media capture');
    try {
      this.localStream?.getTracks().forEach((track) => track.stop());
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream.getTracks().forEach((track) => {
        track.addEventListener?.('ended', () => this.onError(`${track.kind} device stopped`));
      });
      return this.localStream;
    } catch (error) {
      this.onError(`Unable to access camera or microphone: ${error.message}`);
      throw error;
    }
  }

  async connectSignaling() {
    if (this.ws?.readyState === WebSocket.OPEN && this.peerId) return this.peerId;
    if (this.connectPromise) return this.connectPromise;
    await this.fetchIceServers();
    this.closing = false;
    const base = new URL(this.baseUrl, window.location.href);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${base.host}/rtc/ws`;
    this.onStatusChange('Connecting to signaling server...');
    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => this.onStatusChange('Signaling connected');
      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await this.handleSignalingMessage(message);
          if (message.type === 'welcome' && !settled) {
            settled = true;
            this.peerId = message.peer_id;
            this.reconnectAttempts = 0;
            resolve(this.peerId);
            this.flushTranscriptQueue();
          }
        } catch (error) {
          console.error('[WebRTC] Signaling message failed:', error);
          this.onError(error.message || 'Invalid signaling message');
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Signaling connection failed'));
        }
        this.onError('Signaling connection error');
      };
      ws.onclose = () => {
        this.onStatusChange('Signaling disconnected');
        this.ws = null;
        this.peerId = null;
        if (!this.closing && this.roomId) this.scheduleReconnect();
      };
    }).finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.closing || this.reconnectAttempts >= 5) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectSignaling();
        if (this.roomId) this.joinRoom(this.roomId, { hostToken: this.hostToken, displayName: this.displayName });
      } catch (error) {
        this.onError('Unable to reconnect to signaling server');
        this.scheduleReconnect();
      }
    }, delay);
  }

  joinRoom(roomId, options = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Signaling WebSocket is not connected');
    this.roomId = roomId;
    this.hostToken = options.hostToken || this.hostToken;
    this.displayName = options.displayName || this.displayName;
    this.sendSignal({ type: 'join', join: { room_id: roomId, display_name: this.displayName, host_token: this.hostToken } });
    this.onStatusChange(`Joining meeting ${roomId}`);
  }

  sendSignal(message) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  admitPeer(targetId) {
    return this.sendSignal({ type: 'admit_peer', admission: { target_peer_id: targetId, room_id: this.roomId } });
  }

  rejectPeer(targetId) {
    return this.sendSignal({ type: 'reject_peer', admission: { target_peer_id: targetId, room_id: this.roomId } });
  }

  async handleSignalingMessage(message) {
    const peerEvent = message.peer_event || {};
    switch (message.type) {
      case 'welcome':
        this.peerId = message.peer_id;
        break;
      case 'waiting_for_host':
        this.onStatusChange('Waiting for host admission...');
        this.onWaitingForHost();
        break;
      case 'join_request_recvd':
        this.onJoinRequest(peerEvent);
        break;
      case 'join_rejected':
        this.onJoinRejected(message.message || 'Join request rejected');
        break;
      case 'room_info':
        this.onRoomInfo(message);
        for (const remote of message.peers || []) this.onPeerJoined(remote.peer_id, remote);
        break;
      case 'session_ended':
        this.onSessionEnded(message.message || 'Meeting ended');
        this.stopTranscription();
        break;
      case 'peer_joined': {
        const remoteId = peerEvent.peer_id || message.peer_id;
        if (!remoteId || remoteId === this.peerId) break;
        this.onPeerJoined(remoteId, peerEvent);
        await this.createPeerConnection(remoteId, true);
        break;
      }
      case 'peer_left': {
        const remoteId = peerEvent.peer_id || message.peer_id;
        if (remoteId) {
          this.removePeer(remoteId);
          this.onPeerLeft(remoteId);
        }
        break;
      }
      case 'offer': {
        const sdp = message.sdp || {};
        await this.handleOffer(message.from_peer_id || sdp.target_peer_id, sdp.sdp);
        break;
      }
      case 'answer': {
        const sdp = message.sdp || {};
        await this.handleAnswer(message.from_peer_id || sdp.target_peer_id, sdp.sdp);
        break;
      }
      case 'ice_candidate': {
        const ice = message.ice || {};
        await this.handleIceCandidate(message.from_peer_id || ice.target_peer_id, ice);
        break;
      }
      case 'transcript':
        this.onTranscript(message.transcript);
        break;
      case 'error':
        this.onError(message.error?.message || message.message || 'Signaling error');
        break;
      default:
        console.warn('[WebRTC] Unknown signaling message:', message.type);
    }
  }

  async createPeerConnection(remotePeerId, isInitiator = false) {
    const existing = this.peers.get(remotePeerId);
    if (existing) return existing.connection;
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { connection, stream: new MediaStream(), remoteDescriptionReady: false, restartTimer: null };
    this.peers.set(remotePeerId, peer);
    this.localStream?.getTracks().forEach((track) => connection.addTrack(track, this.localStream));
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal({ type: 'ice_candidate', ice: { ...candidate.toJSON(), sdp_mid: candidate.sdpMid, sdp_mline_index: candidate.sdpMLineIndex, target_peer_id: remotePeerId } });
    };
    connection.ontrack = ({ track, streams }) => {
      const source = streams?.[0];
      if (source) source.getTracks().forEach((item) => { if (!peer.stream.getTracks().some((existingTrack) => existingTrack.id === item.id)) peer.stream.addTrack(item); });
      else if (!peer.stream.getTracks().some((item) => item.id === track.id)) peer.stream.addTrack(track);
      this.onRemoteTrack(remotePeerId, peer.stream);
    };
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      this.onStatusChange(`Media ${remotePeerId.slice(0, 6)}: ${state}`);
      if (state === 'connected') clearTimeout(peer.restartTimer);
      if (state === 'failed') this.restartPeerConnection(remotePeerId);
      if (state === 'disconnected') {
        clearTimeout(peer.restartTimer);
        peer.restartTimer = setTimeout(() => this.restartPeerConnection(remotePeerId), 3000);
      }
      if (state === 'closed') this.removePeer(remotePeerId);
    };
    if (isInitiator) await this.sendOffer(remotePeerId, connection);
    return connection;
  }

  async sendOffer(remotePeerId, connection, iceRestart = false) {
    const offer = await connection.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await connection.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: { sdp: offer.sdp, sdp_type: offer.type, target_peer_id: remotePeerId } });
  }

  async handleOffer(remotePeerId, sdp) {
    if (!remotePeerId || !sdp) return;
    const connection = await this.createPeerConnection(remotePeerId, false);
    const peer = this.peers.get(remotePeerId);
    if (connection.signalingState === 'have-local-offer') await connection.setLocalDescription({ type: 'rollback' });
    await connection.setRemoteDescription({ type: 'offer', sdp });
    peer.remoteDescriptionReady = true;
    await this.flushIceCandidates(remotePeerId);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    this.sendSignal({ type: 'answer', sdp: { sdp: answer.sdp, sdp_type: answer.type, target_peer_id: remotePeerId } });
  }

  async handleAnswer(remotePeerId, sdp) {
    const peer = this.peers.get(remotePeerId);
    if (!peer || !sdp) return;
    await peer.connection.setRemoteDescription({ type: 'answer', sdp });
    peer.remoteDescriptionReady = true;
    await this.flushIceCandidates(remotePeerId);
  }

  async handleIceCandidate(remotePeerId, candidate) {
    if (!remotePeerId || !candidate?.candidate) return;
    const peer = this.peers.get(remotePeerId);
    if (!peer || !peer.remoteDescriptionReady || !peer.connection.remoteDescription) {
      const pending = this.pendingIceCandidates.get(remotePeerId) || [];
      if (pending.length < 128) pending.push(candidate);
      this.pendingIceCandidates.set(remotePeerId, pending);
      return;
    }
    try {
      await peer.connection.addIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdp_mid ?? candidate.sdpMid, sdpMLineIndex: candidate.sdp_mline_index ?? candidate.sdpMLineIndex });
    } catch (error) {
      this.onError(`ICE candidate rejected: ${error.message}`);
    }
  }

  async flushIceCandidates(remotePeerId) {
    const pending = this.pendingIceCandidates.get(remotePeerId) || [];
    this.pendingIceCandidates.delete(remotePeerId);
    for (const candidate of pending) await this.handleIceCandidate(remotePeerId, candidate);
  }

  async restartPeerConnection(remotePeerId) {
    const peer = this.peers.get(remotePeerId);
    if (!peer || peer.connection.connectionState === 'closed') return;
    try {
      await this.sendOffer(remotePeerId, peer.connection, true);
    } catch (error) {
      this.removePeer(remotePeerId);
      await this.createPeerConnection(remotePeerId, true);
    }
  }

  startTranscription() {
    if (!this.transcriptionAdapter || !this.roomId || !this.peerId) return false;
    this.transcription = new TranscriptionSession({ meetingId: this.roomId, participantId: this.peerId, adapter: this.transcriptionAdapter, sendEvent: (event) => this.sendTranscriptEvent(event) });
    return this.transcription.start().catch((error) => {
      this.onError(`Transcription unavailable: ${error.message}`);
      this.transcription = null;
      return false;
    });
  }

  stopTranscription() {
    this.transcription?.stop();
    this.transcription = null;
  }

  sendTranscriptEvent(event) {
    const message = { type: 'transcript', transcript: event };
    if (!this.sendSignal(message)) {
      if (this.transcriptQueue.length >= this.maxTranscriptQueue) this.transcriptQueue.shift();
      this.transcriptQueue.push(message);
    }
  }

  flushTranscriptQueue() {
    while (this.transcriptQueue.length && this.ws?.readyState === WebSocket.OPEN) this.sendSignal(this.transcriptQueue.shift());
  }

  toggleAudio() {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    this.audioMuted = !track.enabled;
    return this.audioMuted;
  }

  toggleVideo() {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    this.videoMuted = !track.enabled;
    return this.videoMuted;
  }

  removePeer(remotePeerId) {
    const peer = this.peers.get(remotePeerId);
    if (!peer) return;
    clearTimeout(peer.restartTimer);
    peer.connection.close();
    this.peers.delete(remotePeerId);
    this.pendingIceCandidates.delete(remotePeerId);
  }

  leaveRoom() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.roomId) this.sendSignal({ type: 'leave', leave: { room_id: this.roomId } });
    this.stopTranscription();
    for (const peerId of [...this.peers.keys()]) this.removePeer(peerId);
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.roomId = null;
    this.hostToken = null;
    this.onStatusChange('Left meeting');
  }

  disconnect() {
    this.leaveRoom();
    if (this.ws) this.ws.close();
    this.ws = null;
    this.peerId = null;
  }
}
