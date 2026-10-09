/**
 * Main Application Module (Teapot Workspace System)
 * Handles UI interactions, view navigation, multi-theme switching, and conversation history.
 */

import { API_CONFIG, UI_MESSAGES } from './modules/constants.js';
import { WebRTCClient } from './modules/webrtcClient.js';

let rtcClient = null;

// Local session state container for frontend prototype demonstration
const appState = {
  theme: 'crimson-eclipse',
  account: {
    displayName: 'Jane Doe',
    email: 'jane.doe@example.com',
    role: 'Product Manager',
    language: 'en-US',
    summaryLength: 'balanced',
    insights: {
      decisions: true,
      tasks: true,
      risks: false,
      suggestions: true
    }
  },
  customization: {
    priorities: {
      key_points: true,
      decisions: true,
      tasks: true,
      deadlines: true,
      risks: false,
      budgets: false,
      questions: false,
      opportunities: true
    },
    approach: {
      clarifying: true,
      followup: true,
      disagree: false,
      negotiation: false,
      uncover_risks: false,
      evidence: false,
      objections: false,
      responses: true
    },
    responseStyle: 'diplomatic'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initThemeManager();
  initSidebarToggle();
  initViewNavigation();
  initMeetingControls();
  initAccountSettings();
  initCustomizationControls();
  fetchConversationsHistory();
});

/**
 * Multi-Theme Management System
 * Supports 7 Dark Gradient Themes in Settings + Light Theme + Top-Bar Toggle Alternating
 */
function initThemeManager() {
  const THEME_STORAGE_KEY = 'teapot_theme_key';
  const THEMES = [
    { id: 'crimson-eclipse', name: 'Crimson Eclipse' },
    { id: 'light-theme', name: 'Light Theme' },
    { id: 'emerald-afterdark', name: 'Emerald Afterdark' },
    { id: 'cobalt-night', name: 'Cobalt Night' },
    { id: 'amethyst-smoke', name: 'Amethyst Smoke' },
    { id: 'copper-ember', name: 'Copper Ember' },
    { id: 'arctic-teal', name: 'Arctic Teal' },
    { id: 'golden-dusk', name: 'Golden Dusk' }
  ];

  const themeToggleBtn = document.getElementById('themeToggleBtn');

  function applyTheme(themeId) {
    const themeObj = THEMES.find((t) => t.id === themeId) || THEMES[0];
    const targetTheme = themeObj.id;
    appState.theme = targetTheme;

    document.documentElement.setAttribute('data-theme', targetTheme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, targetTheme);
    } catch (err) {
      console.warn('Unable to persist theme to localStorage:', err);
    }

    // Update active UI card in theme selector grid
    document.querySelectorAll('.theme-card').forEach((card) => {
      const cardThemeId = card.getAttribute('data-theme-id');
      if (cardThemeId === targetTheme) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // Update header quick theme toggle button tooltip
    if (themeToggleBtn) {
      const targetLabel = (targetTheme === 'light-theme') ? 'Crimson Eclipse' : 'Light Theme';
      themeToggleBtn.setAttribute('title', `Current theme: ${themeObj.name} (Click to switch to ${targetLabel})`);
    }
  }

  /**
   * Top-Bar Toggle Handler:
   * Alternates strictly between Crimson Eclipse and Light Theme.
   * If any alternative gradient theme is active, switches to Crimson Eclipse.
   */
  function handleTopBarToggle() {
    if (appState.theme === 'light-theme') {
      applyTheme('crimson-eclipse');
    } else if (appState.theme === 'crimson-eclipse') {
      applyTheme('light-theme');
    } else {
      // If currently on any alternative gradient theme (Emerald, Cobalt, etc.)
      applyTheme('crimson-eclipse');
    }
  }

  // Load initial theme from localStorage or default
  let savedTheme = 'crimson-eclipse';
  try {
    savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'crimson-eclipse';
  } catch (err) {
    savedTheme = 'crimson-eclipse';
  }

  applyTheme(savedTheme);

  // Attach click listener for header quick theme toggle button
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleTopBarToggle();
    });
  }

  // Attach click listeners to theme selection cards in Account Settings grid
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.addEventListener('click', () => {
      const themeId = card.getAttribute('data-theme-id');
      if (themeId) {
        applyTheme(themeId);
      }
    });
  });
}

/**
 * Mobile Sidebar Toggle Handler
 */
function initSidebarToggle() {
  const sidebar = document.getElementById('appSidebar');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');

  if (sidebarToggleBtn && sidebar) {
    sidebarToggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('show');
    });

    document.addEventListener('click', (event) => {
      if (window.innerWidth < 992) {
        const isClickInsideSidebar = sidebar.contains(event.target);
        const isClickOnToggle = sidebarToggleBtn.contains(event.target);

        if (!isClickInsideSidebar && !isClickOnToggle && sidebar.classList.contains('show')) {
          sidebar.classList.remove('show');
        }
      }
    });
  }
}

/**
 * Single-Page View Navigation (Home, Jump into Conversation, Around the Globe, Account Settings, Customization)
 */
function initViewNavigation() {
  const views = {
    home: document.getElementById('homeView'),
    startMeeting: document.getElementById('startMeetingView'),
    aroundGlobe: document.getElementById('aroundGlobeView'),
    accountSettings: document.getElementById('accountSettingsView'),
    customization: document.getElementById('customizationView')
  };

  const navHomeLink = document.getElementById('navHomeLink');
  const navJumpLink = document.getElementById('navJumpLink');
  const jumpConversationLink = document.getElementById('jumpConversationLink');
  const backToHomeBtn = document.getElementById('backToHomeBtn');
  const aroundGlobeBackBtn = document.getElementById('aroundGlobeBackBtn');
  const accountBackBtn = document.getElementById('accountBackBtn');
  const customizationBackBtn = document.getElementById('customizationBackBtn');
  const goToCustomizationBtn = document.getElementById('goToCustomizationBtn');

  const dropdownAccountLink = document.getElementById('dropdownAccountLink');
  const dropdownPreferencesLink = document.getElementById('dropdownPreferencesLink');
  const headerPageTitle = document.getElementById('headerPageTitle');

  function switchView(targetKey, titleText) {
    Object.keys(views).forEach((key) => {
      if (views[key]) {
        if (key === targetKey) {
          views[key].classList.remove('d-none');
        } else {
          views[key].classList.add('d-none');
        }
      }
    });

    if (navHomeLink && navJumpLink) {
      if (targetKey === 'home') {
        navHomeLink.classList.add('active');
        navJumpLink.classList.remove('active');
      } else if (targetKey === 'startMeeting' || targetKey === 'aroundGlobe') {
        navHomeLink.classList.remove('active');
        navJumpLink.classList.add('active');
      } else {
        navHomeLink.classList.remove('active');
        navJumpLink.classList.remove('active');
      }
    }

    if (headerPageTitle && titleText) {
      headerPageTitle.textContent = titleText;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (jumpConversationLink) {
    jumpConversationLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('startMeeting', 'Jump into the Conversation');
    });
  }

  if (navJumpLink) {
    navJumpLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('startMeeting', 'Jump into the Conversation');
    });
  }

  if (navHomeLink) {
    navHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home', 'Home');
    });
  }

  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home', 'Home');
    });
  }

  if (aroundGlobeBackBtn) {
    aroundGlobeBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('startMeeting', 'Jump into the Conversation');
    });
  }

  if (accountBackBtn) {
    accountBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home', 'Home');
    });
  }

  if (customizationBackBtn) {
    customizationBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('accountSettings', 'Account Settings');
    });
  }

  if (goToCustomizationBtn) {
    goToCustomizationBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('customization', 'Customization');
    });
  }

  if (dropdownAccountLink) {
    dropdownAccountLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('accountSettings', 'Account Settings');
    });
  }

  if (dropdownPreferencesLink) {
    dropdownPreferencesLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('customization', 'Customization');
    });
  }

  window.__teapotSwitchView = switchView;
}

/**
 * Controls for Jump into Conversation & Around the Globe (WebRTC Video Conferencing)
 */
function initMeetingControls() {
  const aroundGlobeCard = document.getElementById('aroundGlobeCard');
  const aroundTableCard = document.getElementById('aroundTableCard');
  const jumpOptionFeedback = document.getElementById('jumpOptionFeedback');

  const aroundGlobeForm = document.getElementById('aroundGlobeForm');
  const globeCodeInput = document.getElementById('globeCodeInput');
  const globeFeedback = document.getElementById('globeFeedback');

  const webrtcJoinCard = document.getElementById('webrtcJoinCard');
  const videoConferenceInterface = document.getElementById('videoConferenceInterface');
  const conferenceRoomTitle = document.getElementById('conferenceRoomTitle');
  const webrtcStatusLabel = document.getElementById('webrtcStatusLabel');
  const webrtcPeerCountBadge = document.getElementById('webrtcPeerCountBadge');
  const videoGridContainer = document.getElementById('videoGridContainer');
  const localVideo = document.getElementById('localVideo');

  const toggleAudioBtn = document.getElementById('toggleAudioBtn');
  const audioBtnIcon = document.getElementById('audioBtnIcon');
  const toggleVideoBtn = document.getElementById('toggleVideoBtn');
  const videoBtnIcon = document.getElementById('videoBtnIcon');
  const leaveCallBtn = document.getElementById('leaveCallBtn');

  if (aroundGlobeCard) {
    aroundGlobeCard.addEventListener('click', () => {
      if (window.__teapotSwitchView) {
        window.__teapotSwitchView('aroundGlobe', 'Around the Globe');
      }
    });
  }

  if (aroundTableCard && jumpOptionFeedback) {
    aroundTableCard.addEventListener('click', () => {
      jumpOptionFeedback.classList.remove('d-none');
      jumpOptionFeedback.className = 'sidebar-status-msg status-empty mt-4';
      jumpOptionFeedback.replaceChildren();

      const icon = document.createElement('i');
      icon.className = 'bi bi-info-circle';
      const span = document.createElement('span');
      span.textContent = '"Around the Table" local multi-peer session ready.';

      jumpOptionFeedback.appendChild(icon);
      jumpOptionFeedback.appendChild(span);
    });
  }

  if (aroundGlobeForm && globeCodeInput) {
    aroundGlobeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const roomId = globeCodeInput.value.trim();

      if (!roomId) {
        if (globeFeedback) {
          globeFeedback.classList.remove('d-none');
          globeFeedback.className = 'sidebar-status-msg status-error mt-3';
          globeFeedback.replaceChildren();
          const icon = document.createElement('i');
          icon.className = 'bi bi-exclamation-triangle-fill';
          const span = document.createElement('span');
          span.textContent = 'Please enter a valid room ID or code.';
          globeFeedback.appendChild(icon);
          globeFeedback.appendChild(span);
        }
        return;
      }

      try {
        if (globeFeedback) {
          globeFeedback.classList.remove('d-none');
          globeFeedback.className = 'sidebar-status-msg status-empty mt-3';
          globeFeedback.textContent = 'Acquiring camera & connecting to WebRTC...';
        }

        // Initialize WebRTC client
        rtcClient = new WebRTCClient({
          baseUrl: API_CONFIG.BASE_URL,
          onStatusChange: (statusText) => {
            if (webrtcStatusLabel) webrtcStatusLabel.textContent = `Status: ${statusText}`;
          },
          onPeerJoined: (peerId) => {
            console.log('Peer joined UI handler:', peerId);
            updatePeerCountBadge();
          },
          onPeerLeft: (peerId) => {
            console.log('Peer left UI handler:', peerId);
            removeRemoteVideoTile(peerId);
            updatePeerCountBadge();
          },
          onRemoteTrack: (peerId, stream) => {
            console.log('Remote track UI handler:', peerId);
            addOrUpdateRemoteVideoTile(peerId, stream);
          },
          onError: (errMsg) => {
            alert(`WebRTC Error: ${errMsg}`);
          }
        });

        // 1. Acquire local camera stream
        const stream = await rtcClient.startLocalStream({ audio: true, video: true });
        if (localVideo) {
          localVideo.srcObject = stream;
        }

        // 2. Connect signaling WebSocket & join room
        await rtcClient.connectSignaling();
        rtcClient.joinRoom(roomId);

        // Update UI View State
        if (webrtcJoinCard) webrtcJoinCard.classList.add('d-none');
        if (videoConferenceInterface) videoConferenceInterface.classList.remove('d-none');
        if (conferenceRoomTitle) conferenceRoomTitle.textContent = `Room: ${roomId}`;
        updatePeerCountBadge();

      } catch (err) {
        console.error('Failed to start WebRTC session:', err);
        if (globeFeedback) {
          globeFeedback.className = 'sidebar-status-msg status-error mt-3';
          globeFeedback.textContent = `Connection failed: ${err.message}`;
        }
      }
    });
  }

  // Audio Toggle Button
  if (toggleAudioBtn) {
    toggleAudioBtn.addEventListener('click', () => {
      if (!rtcClient) return;
      const isMuted = rtcClient.toggleAudio();
      if (isMuted) {
        toggleAudioBtn.classList.replace('btn-outline-light', 'btn-warning');
        if (audioBtnIcon) audioBtnIcon.className = 'bi bi-mic-mute-fill fs-5';
      } else {
        toggleAudioBtn.classList.replace('btn-warning', 'btn-outline-light');
        if (audioBtnIcon) audioBtnIcon.className = 'bi bi-mic-fill fs-5';
      }
    });
  }

  // Video Toggle Button
  if (toggleVideoBtn) {
    toggleVideoBtn.addEventListener('click', () => {
      if (!rtcClient) return;
      const isMuted = rtcClient.toggleVideo();
      if (isMuted) {
        toggleVideoBtn.classList.replace('btn-outline-light', 'btn-warning');
        if (videoBtnIcon) videoBtnIcon.className = 'bi bi-camera-video-off-fill fs-5';
      } else {
        toggleVideoBtn.classList.replace('btn-warning', 'btn-outline-light');
        if (videoBtnIcon) videoBtnIcon.className = 'bi bi-camera-video-fill fs-5';
      }
    });
  }

  // Leave Call Button
  if (leaveCallBtn) {
    leaveCallBtn.addEventListener('click', () => {
      if (rtcClient) {
        rtcClient.leaveRoom();
        rtcClient.disconnect();
        rtcClient = null;
      }
      // Reset UI elements
      if (videoConferenceInterface) videoConferenceInterface.classList.add('d-none');
      if (webrtcJoinCard) webrtcJoinCard.classList.remove('d-none');
      if (localVideo) localVideo.srcObject = null;
      // Remove remote videos
      document.querySelectorAll('.remote-video-tile').forEach(tile => tile.remove());
    });
  }

  function addOrUpdateRemoteVideoTile(peerId, stream) {
    let tile = document.getElementById(`remote-tile-${peerId}`);
    if (!tile && videoGridContainer) {
      tile = document.createElement('div');
      tile.className = 'col-12 col-md-6 remote-video-tile';
      tile.id = `remote-tile-${peerId}`;

      tile.innerHTML = `
        <div class="video-stream-box position-relative rounded overflow-hidden bg-dark" style="aspect-ratio: 16/9;">
          <video id="video-peer-${peerId}" autoplay playsinline class="w-100 h-100 object-fit-cover"></video>
          <div class="position-absolute bottom-0 start-0 m-2 px-2 py-1 bg-dark bg-opacity-75 text-white rounded small">
            <i class="bi bi-person me-1"></i> Peer (${peerId.slice(0, 6)}...)
          </div>
        </div>
      `;
      videoGridContainer.appendChild(tile);
    }

    const videoElem = document.getElementById(`video-peer-${peerId}`);
    if (videoElem) {
      videoElem.srcObject = stream;
    }
  }

  function removeRemoteVideoTile(peerId) {
    const tile = document.getElementById(`remote-tile-${peerId}`);
    if (tile) tile.remove();
  }

  function updatePeerCountBadge() {
    if (!webrtcPeerCountBadge) return;
    const peerCount = rtcClient ? rtcClient.peers.size + 1 : 1;
    webrtcPeerCountBadge.innerHTML = `<i class="bi bi-people"></i> ${peerCount} Participant${peerCount > 1 ? 's' : ''}`;
  }
}

/**
 * Account Settings View Handler & State Management
 */
function initAccountSettings() {
  const form = document.getElementById('accountSettingsForm');
  const resetBtn = document.getElementById('resetAccountSettingsBtn');
  const feedback = document.getElementById('accountSettingsFeedback');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const nameInput = document.getElementById('settingDisplayName');
      const emailInput = document.getElementById('settingEmail');
      const roleInput = document.getElementById('settingRole');
      const languageSelect = document.getElementById('settingLanguage');
      const summaryLengthRadio = document.querySelector('input[name="summaryLength"]:checked');

      if (nameInput) appState.account.displayName = nameInput.value.trim();
      if (emailInput) appState.account.email = emailInput.value.trim();
      if (roleInput) appState.account.role = roleInput.value.trim();
      if (languageSelect) appState.account.language = languageSelect.value;
      if (summaryLengthRadio) appState.account.summaryLength = summaryLengthRadio.value;

      appState.account.insights.decisions = document.getElementById('insightDecisions')?.checked || false;
      appState.account.insights.tasks = document.getElementById('insightTasks')?.checked || false;
      appState.account.insights.risks = document.getElementById('insightRisks')?.checked || false;
      appState.account.insights.suggestions = document.getElementById('insightSuggestions')?.checked || false;

      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();

        const icon = document.createElement('i');
        icon.className = 'bi bi-check-circle-fill text-success';
        const span = document.createElement('span');
        span.textContent = 'Account settings saved for local session.';

        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('settingDisplayName');
      const emailInput = document.getElementById('settingEmail');
      const roleInput = document.getElementById('settingRole');
      const languageSelect = document.getElementById('settingLanguage');

      if (nameInput) nameInput.value = 'Jane Doe';
      if (emailInput) emailInput.value = 'jane.doe@example.com';
      if (roleInput) roleInput.value = 'Product Manager';
      if (languageSelect) languageSelect.value = 'en-US';

      const balancedRadio = document.getElementById('summaryBalanced');
      if (balancedRadio) balancedRadio.checked = true;

      const insightDecisions = document.getElementById('insightDecisions');
      const insightTasks = document.getElementById('insightTasks');
      const insightRisks = document.getElementById('insightRisks');
      const insightSuggestions = document.getElementById('insightSuggestions');

      if (insightDecisions) insightDecisions.checked = true;
      if (insightTasks) insightTasks.checked = true;
      if (insightRisks) insightRisks.checked = false;
      if (insightSuggestions) insightSuggestions.checked = true;

      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();

        const icon = document.createElement('i');
        icon.className = 'bi bi-info-circle';
        const span = document.createElement('span');
        span.textContent = 'Account settings restored to defaults for current session.';

        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
  }
}

/**
 * Customization View Handler & Priorities/Approach State Management
 */
function initCustomizationControls() {
  const form = document.getElementById('customizationForm');
  const resetSectionABtn = document.getElementById('resetSectionABtn');
  const resetSectionBBtn = document.getElementById('resetSectionBBtn');
  const resetAllBtn = document.getElementById('resetAllCustomizationBtn');
  const feedback = document.getElementById('customizationFeedback');

  function resetSectionA() {
    const defaultA = {
      priority_key_points: true,
      priority_decisions: true,
      priority_tasks: true,
      priority_deadlines: true,
      priority_risks: false,
      priority_budgets: false,
      priority_questions: false,
      priority_opportunities: true
    };
    Object.keys(defaultA).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = defaultA[id];
    });
  }

  function resetSectionB() {
    const defaultB = {
      approach_clarifying: true,
      approach_followup: true,
      approach_disagree: false,
      approach_negotiation: false,
      approach_uncover_risks: false,
      approach_evidence: false,
      approach_objections: false,
      approach_responses: true
    };
    Object.keys(defaultB).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = defaultB[id];
    });
    const diplomaticStyle = document.getElementById('styleDiplomatic');
    if (diplomaticStyle) diplomaticStyle.checked = true;
    updateResponseStyleSelection();
  }

  function updateResponseStyleSelection() {
    document.querySelectorAll('.response-style-pill').forEach((pill) => {
      const radio = pill.querySelector('input[type="radio"]');
      if (radio && radio.checked) {
        pill.classList.add('selected');
      } else {
        pill.classList.remove('selected');
      }
    });
  }

  document.querySelectorAll('input[name="responseStyle"]').forEach((radio) => {
    radio.addEventListener('change', updateResponseStyleSelection);
  });

  if (resetSectionABtn) {
    resetSectionABtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetSectionA();
    });
  }

  if (resetSectionBBtn) {
    resetSectionBBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetSectionB();
    });
  }

  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetSectionA();
      resetSectionB();

      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();

        const icon = document.createElement('i');
        icon.className = 'bi bi-info-circle';
        const span = document.createElement('span');
        span.textContent = 'All customization preferences restored to default values.';

        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const priorityKeys = ['key_points', 'decisions', 'tasks', 'deadlines', 'risks', 'budgets', 'questions', 'opportunities'];
      priorityKeys.forEach((key) => {
        const el = document.getElementById(`priority_${key}`);
        if (el) appState.customization.priorities[key] = el.checked;
      });

      const approachKeys = ['clarifying', 'followup', 'disagree', 'negotiation', 'uncover_risks', 'evidence', 'objections', 'responses'];
      approachKeys.forEach((key) => {
        const el = document.getElementById(`approach_${key}`);
        if (el) appState.customization.approach[key] = el.checked;
      });

      const styleRadio = document.querySelector('input[name="responseStyle"]:checked');
      if (styleRadio) appState.customization.responseStyle = styleRadio.value;

      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();

        const icon = document.createElement('i');
        icon.className = 'bi bi-check-circle-fill text-success';
        const span = document.createElement('span');
        span.textContent = 'Customization priorities and conversation approach updated for local session.';

        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
  }
}

/**
 * Asynchronously Fetches Past Conversations from API
 */
async function fetchConversationsHistory() {
  const container = document.getElementById('conversationList');
  if (!container) return;

  renderStatusMessage(container, UI_MESSAGES.LOADING_HISTORY, 'status-loading');

  try {
    const requestUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.CONVERSATIONS_ENDPOINT}`;
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: API_CONFIG.HEADERS
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    let conversations = null;
    if (Array.isArray(data)) {
      conversations = data;
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.conversations)) {
        conversations = data.conversations;
      } else if (Array.isArray(data.data)) {
        conversations = data.data;
      } else if (Array.isArray(data.items)) {
        conversations = data.items;
      }
    }

    if (conversations === null) {
      throw new Error('Invalid conversation payload structure');
    }

    if (conversations.length === 0) {
      renderStatusMessage(container, UI_MESSAGES.EMPTY_HISTORY, 'status-empty');
    } else {
      renderConversationsList(container, conversations);
    }

  } catch (error) {
    console.warn('API fetch error for past conversations:', error.message || error);
    renderStatusMessage(container, UI_MESSAGES.ERROR_HISTORY, 'status-error');
  }
}

/**
 * Renders status messages in the sidebar
 */
function renderStatusMessage(container, text, statusClass) {
  container.replaceChildren();

  const li = document.createElement('li');
  const msgDiv = document.createElement('div');
  msgDiv.className = `sidebar-status-msg ${statusClass}`;

  const icon = document.createElement('i');
  if (statusClass === 'status-loading') {
    icon.className = 'bi bi-hourglass-split';
  } else if (statusClass === 'status-empty') {
    icon.className = 'bi bi-inbox';
  } else {
    icon.className = 'bi bi-exclamation-triangle-fill';
  }

  const span = document.createElement('span');
  span.textContent = text;

  msgDiv.appendChild(icon);
  msgDiv.appendChild(span);
  li.appendChild(msgDiv);
  container.appendChild(li);
}

/**
 * Renders conversation items safely into the sidebar
 */
function renderConversationsList(container, conversations) {
  container.replaceChildren();

  conversations.forEach((item) => {
    const li = document.createElement('li');
    
    const a = document.createElement('a');
    a.className = 'conversation-item';
    a.href = '#';
    a.tabIndex = 0;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'conversation-title';
    titleSpan.textContent = item.title || item.name || item.topic || `Conversation #${item.id || ''}`;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'conversation-meta';
    metaSpan.textContent = item.date || item.created_at || item.timestamp || 'Recorded conversation';

    a.appendChild(titleSpan);
    a.appendChild(metaSpan);
    li.appendChild(a);
    container.appendChild(li);
  });
}
