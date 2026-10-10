/**
 * Live transcript tree.
 *
 * The tree accepts the meeting state emitted by the analyzer (`topics`,
 * `summary_points`, and `action_items`) and the transcript event shape used
 * by the WebRTC signaling client. It deliberately uses native SVG so the
 * meeting page does not need a second visualization dependency.
 */

function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function timeToSeconds(value) {
  if (typeof value !== 'string') return Number.POSITIVE_INFINITY;
  const match = value.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function eventKey(event) {
  if (event.participant_id && event.session_id && event.sequence_number !== undefined) {
    return `${event.participant_id}:${event.session_id}:${event.sequence_number}`;
  }
  return event.event_id || `event:${event.timestamp || Date.now()}:${event.text || ''}`;
}

export class TranscriptTree {
  constructor(options = {}) {
    this.container = document.getElementById(options.containerId || 'transcriptTreeContainer');
    this.svg = document.getElementById(options.svgId || 'transcriptTreeSvg');
    this.status = document.getElementById(options.statusId || 'treeStatus');
    this.details = document.getElementById(options.detailsId || 'treeDetails');
    this.nodes = new Map();
    this.events = new Map();
    this.expanded = new Set(['root']);
    this.selectedId = null;
    this.pan = { x: 20, y: 20 };
    this.scale = 1;
    this.drag = null;
    this.lastUpdated = 0;

    if (this.svg) this.bindInteractions();
  }

  bindInteractions() {
    this.svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.scale = Math.min(2.2, Math.max(0.45, this.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
      this.render();
    }, { passive: false });

    this.svg.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.tree-node')) return;
      this.drag = { x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y };
      this.svg.setPointerCapture(event.pointerId);
    });
    this.svg.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      this.pan.x = this.drag.panX + event.clientX - this.drag.x;
      this.pan.y = this.drag.panY + event.clientY - this.drag.y;
      this.render();
    });
    this.svg.addEventListener('pointerup', () => { this.drag = null; });
    this.svg.addEventListener('pointercancel', () => { this.drag = null; });
  }

  reset() {
    this.nodes.clear();
    this.events.clear();
    this.selectedId = null;
    this.expanded = new Set(['root']);
    this.lastUpdated = 0;
    this.render();
  }

  applyState(state = {}) {
    const meetingId = safeText(state.meeting_id, 'meeting');
    const root = this.ensureNode('root', {
      type: 'root',
      label: safeText(state.meeting_title, 'Meeting'),
      detail: safeText(state.meeting_summary, 'Waiting for transcript data.')
    });
    root.label = safeText(state.meeting_title, root.label);
    root.detail = safeText(state.meeting_summary, root.detail);
    root.status = safeText(state.meeting_status, 'in_progress');
    root.meetingId = meetingId;

    for (const topic of Array.isArray(state.topics) ? state.topics : []) {
      this.upsertTopic(topic);
    }
    if (typeof state.transcript === 'string') this.ingestTranscript(state.transcript);
    this.setStatus(state.meeting_status === 'completed' ? 'Completed' : 'Live');
    this.render();
  }

  upsertTopic(topic = {}) {
    const topicId = safeText(topic.topic_id, safeText(topic.topic_name, 'topic'));
    const id = `topic:${topicId}`;
    const parentId = topic.branched_from ? `topic:${topic.branched_from}` : 'root';
    const node = this.ensureNode(id, {
      type: 'topic',
      label: safeText(topic.topic_name, 'Untitled topic'),
      parentId,
      detail: safeText(topic.nature, 'discussion'),
      nature: safeText(topic.nature, 'informational'),
      status: safeText(topic.status, 'active'),
      startTime: safeText(topic.start_time),
      endTime: safeText(topic.end_time)
    });
    Object.assign(node, {
      label: safeText(topic.topic_name, node.label),
      parentId,
      detail: safeText(topic.nature, node.detail),
      nature: safeText(topic.nature, node.nature),
      status: safeText(topic.status, node.status),
      startTime: safeText(topic.start_time, node.startTime),
      endTime: safeText(topic.end_time, node.endTime)
    });

    const points = Array.isArray(topic.summary_points) ? topic.summary_points : [];
    points.forEach((point, index) => this.upsertChild(id, `point:${topicId}:${index}`, 'point', point));
    const actions = Array.isArray(topic.action_items) ? topic.action_items : [];
    actions.forEach((action, index) => this.upsertChild(id, `action:${topicId}:${index}`, 'action', action));
    return node;
  }

  upsertChild(parentId, id, type, value) {
    const label = typeof value === 'string' ? value : safeText(value?.text, safeText(value?.title, 'Item'));
    const node = this.ensureNode(id, { type, label, parentId });
    node.label = label || node.label;
    if (value && typeof value === 'object') {
      node.owner = safeText(value.assigned_to, safeText(value.owner));
      node.deadline = safeText(value.deadline, safeText(value.due_date));
      node.status = safeText(value.status);
    }
  }

  ingestTranscript(transcript) {
    transcript.split(/\n+/).forEach((line, index) => {
      const match = line.match(/^\\[(.*?)\\]\\s*(.*)$/);
      if (match) {
        const timestamp = match[1];
        const text = match[2].replace(/^\d{2}:\d{2}:\d{2}\]\s*/, '');
        this.ingestTranscriptEvent({
          event_id: `transcript:${index}:${timestamp}:${text}`,
          text,
          timestamp,
          event_type: 'final'
        });
      }
    });
  }

  ingestTranscriptEvent(event = {}) {
    const key = eventKey(event);
    if (!safeText(event.text) && event.event_type !== 'final') return;
    const existing = this.events.get(key);
    this.events.set(key, { ...existing, ...event, text: safeText(event.text, existing?.text || '') });
    const current = this.events.get(key);
    const topic = this.findTopic(current);
    const id = `message:${key}`;
    const node = this.ensureNode(id, { type: 'message', parentId: topic?.id || 'root', label: current.text || current.event_type });
    node.label = current.text || node.label;
    node.speaker = safeText(current.participant_id, 'Unknown speaker');
    node.timestamp = safeText(current.timestamp, safeText(current.created_at));
    node.parentId = topic?.id || 'root';
    this.lastUpdated = Date.now();
    this.setStatus('Live');
    this.render();
  }

  findTopic(event) {
    const timestamp = timeToSeconds(safeText(event.timestamp));
    const topics = [...this.nodes.values()].filter((node) => node.type === 'topic');
    return topics
      .filter((topic) => timeToSeconds(topic.startTime) <= timestamp)
      .sort((a, b) => timeToSeconds(b.startTime) - timeToSeconds(a.startTime))[0] || topics[0];
  }

  ensureNode(id, values) {
    if (!this.nodes.has(id)) this.nodes.set(id, { id, children: [], ...values });
    const node = this.nodes.get(id);
    Object.assign(node, values);
    return node;
  }

  childrenOf(parentId) {
    return [...this.nodes.values()].filter((node) => node.parentId === parentId);
  }

  visibleNodes() {
    const result = [];
    const visit = (id, depth) => {
      const node = this.nodes.get(id);
      if (!node) return;
      result.push({ node, depth });
      if (this.expanded.has(id)) this.childrenOf(id).forEach((child) => visit(child.id, depth + 1));
    };
    visit('root', 0);
    return result;
  }

  render() {
    if (!this.svg || !this.nodes.has('root')) return;
    this.container?.classList.remove('d-none');
    const visible = this.visibleNodes();
    const rowHeight = 58;
    const depthWidth = 245;
    const width = Math.max(760, (Math.max(...visible.map(({ depth }) => depth), 0) + 1) * depthWidth + 260);
    const height = Math.max(260, visible.length * rowHeight + 70);
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', String(Math.min(620, height)));
    this.svg.replaceChildren();

    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('transform', `translate(${this.pan.x},${this.pan.y}) scale(${this.scale})`);
    this.svg.appendChild(layer);
    const positions = new Map(visible.map(({ node }, index) => [node.id, { x: 70 + index * rowHeight, y: 40 + ([...visible].find((entry) => entry.node === node)?.depth || 0) * depthWidth }]));

    for (const { node } of visible) {
      if (!node.parentId || !positions.has(node.parentId)) continue;
      const from = positions.get(node.parentId);
      const to = positions.get(node.id);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'tree-link');
      path.setAttribute('d', `M ${from.y + 10} ${from.x} C ${from.y + 100} ${from.x}, ${to.y - 100} ${to.x}, ${to.y - 10} ${to.x}`);
      layer.appendChild(path);
    }

    for (const { node } of visible) {
      const position = positions.get(node.id);
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const semanticType = node.type === 'topic' && node.nature ? ` tree-node-${node.nature}` : '';
      group.setAttribute('class', `tree-node tree-node-${node.type}${semanticType}${this.selectedId === node.id ? ' is-selected' : ''}`);
      group.setAttribute('transform', `translate(${position.y},${position.x})`);
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        if (this.childrenOf(node.id).length) {
          if (this.expanded.has(node.id)) this.expanded.delete(node.id);
          else this.expanded.add(node.id);
        }
        this.selectedId = node.id;
        this.render();
        this.renderDetails(node);
      });
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', node.type === 'root' ? '13' : '9');
      group.appendChild(circle);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', node.type === 'root' ? '20' : '16');
      text.setAttribute('dy', '0.35em');
      text.textContent = node.label.length > 42 ? `${node.label.slice(0, 39)}...` : node.label;
      group.appendChild(text);
      layer.appendChild(group);
    }
  }

  renderDetails(node) {
    if (!this.details) return;
    this.details.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = node.label;
    const body = document.createElement('div');
    body.className = 'small text-secondary mt-1';
    body.textContent = [node.nature, node.status, node.speaker, node.timestamp, node.owner && `Owner: ${node.owner}`, node.deadline && `Due: ${node.deadline}`].filter(Boolean).join(' • ');
    this.details.append(title, body);
  }

  setStatus(mode) {
    if (!this.status) return;
    const labels = {
      Completed: 'Completed meeting',
      Live: 'Live • updates are flowing',
      Connecting: 'Connecting to meeting updates…',
      Reconnecting: 'Reconnecting to meeting updates…',
      Disconnected: 'Disconnected • waiting to reconnect',
      Stale: 'Stale • no update received recently'
    };
    this.status.textContent = labels[mode] || mode;
  }
}

export function createTranscriptTree(options) {
  return new TranscriptTree(options);
}
