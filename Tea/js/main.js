/**
 * Main Application Module (Teapot Workspace System)
 * Handles UI interactions, view navigation, multi-theme switching, and conversation history.
 */

import { API_CONFIG, UI_MESSAGES } from './modules/constants.js';
import { WebRTCClient } from './modules/webrtcClient.js';
import { BrowserSpeechRecognitionAdapter } from './modules/transcription.js';
import { createTranscriptTree } from './transcriptTree.js';

let rtcClient = null;
let transcriptTree = null;
let hasLiveMeetingState = false;
let treeStaleTimer = null;

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
    },
    roleDescription: '',
    rolePoints: []
  },
  customization: {
    priorities: [
      {
        id: "discussion-points",
        label: "Discussion Points",
        enabled: true
      },
      {
        id: "decisions",
        label: "Decisions and Agreements",
        enabled: true
      },
      {
        id: "tasks",
        label: "Tasks and Commitments",
        enabled: true
      },
      {
        id: "deadlines",
        label: "Deadlines",
        enabled: true
      },
      {
        id: "risks",
        label: "Risks and Concerns",
        enabled: true
      },
      {
        id: "costs",
        label: "Costs and Budgets",
        enabled: true
      },
      {
        id: "questions",
        label: "Unanswered Questions",
        enabled: true
      },
      {
        id: "opportunities",
        label: "Opportunities and Next Steps",
        enabled: true
      }
    ],
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

const STORAGE_KEYS = {
  THEME: 'teapot_theme_key',
  CUSTOMIZATION: 'teapot_customization_v1',
  ROLE: 'teapot_role_v1',
  ACCOUNT: 'teapot_account_v1'
};

/**
 * Loads persisted user preferences and role configuration from localStorage
 */
function loadStoredPreferences() {
  try {
    const savedRole = localStorage.getItem(STORAGE_KEYS.ROLE);
    if (savedRole) {
      const parsed = JSON.parse(savedRole);
      if (typeof parsed.roleDescription === 'string') {
        appState.account.roleDescription = parsed.roleDescription;
      }
      if (Array.isArray(parsed.rolePoints)) {
        appState.account.rolePoints = parsed.rolePoints.map((p, idx) => ({
          id: p.id || `point-${Date.now()}-${idx}`,
          text: typeof p === 'string' ? p : (p.text || ''),
          isEditing: false
        }));
      }
    }
  } catch (e) {
    console.warn('Failed to load role from localStorage', e);
  }

  try {
    const savedCustomization = localStorage.getItem(STORAGE_KEYS.CUSTOMIZATION);
    if (savedCustomization) {
      const parsed = JSON.parse(savedCustomization);
      if (Array.isArray(parsed.priorities)) {
        parsed.priorities.forEach((savedItem) => {
          const match = appState.customization.priorities.find((p) => p.id === savedItem.id);
          if (match && typeof savedItem.enabled === 'boolean') {
            match.enabled = savedItem.enabled;
          }
        });
      }
      if (parsed.approach && typeof parsed.approach === 'object') {
        Object.keys(parsed.approach).forEach((key) => {
          if (key in appState.customization.approach) {
            appState.customization.approach[key] = !!parsed.approach[key];
          }
        });
      }
      if (typeof parsed.responseStyle === 'string') {
        appState.customization.responseStyle = parsed.responseStyle;
      }
    }
  } catch (e) {
    console.warn('Failed to load customization from localStorage', e);
  }

  try {
    const savedAccount = localStorage.getItem(STORAGE_KEYS.ACCOUNT);
    if (savedAccount) {
      const parsed = JSON.parse(savedAccount);
      if (parsed.displayName) appState.account.displayName = parsed.displayName;
      if (parsed.email) appState.account.email = parsed.email;
      if (parsed.role) appState.account.role = parsed.role;
      if (parsed.language) appState.account.language = parsed.language;
      if (parsed.summaryLength) appState.account.summaryLength = parsed.summaryLength;
      if (parsed.insights) {
        Object.assign(appState.account.insights, parsed.insights);
      }
    }
  } catch (e) {
    console.warn('Failed to load account from localStorage', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStoredPreferences();
  initThemeManager();
  initSidebarToggle();
  initViewNavigation();
  initMeetingControls();
  initAccountSettings();
  initRoleManagement();
  initCustomizationControls();
  initTranscriptTree();
  const conversationList = document.getElementById('conversationList');
  if (conversationList) renderStatusMessage(conversationList, UI_MESSAGES.EMPTY_HISTORY, 'status-empty');
});

function initTranscriptTree() {
  transcriptTree = createTranscriptTree();
  transcriptTree.applyState({
    meeting_title: 'Meeting',
    meeting_status: 'in_progress',
    meeting_summary: 'Waiting for transcript data.'
  });

  // Live analyzer state is authoritative. The repository fixture is not
  // served by FastAPI, so avoid requesting an unavailable cross-directory URL.
}

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
    role: document.getElementById('roleView'),
    customization: document.getElementById('customizationView')
  };

  const viewTitles = {
    home: 'Home',
    startMeeting: 'Jump into the Conversation',
    aroundGlobe: 'Around the Globe',
    accountSettings: 'Account Settings',
    role: 'Your Role & Objectives',
    customization: 'Conversation Customization'
  };

  const navHomeLink = document.getElementById('navHomeLink');
  const navJumpLink = document.getElementById('navJumpLink');
  const jumpConversationLink = document.getElementById('jumpConversationLink');
  const backToHomeBtn = document.getElementById('backToHomeBtn');
  const aroundGlobeBackBtn = document.getElementById('aroundGlobeBackBtn');
  const accountBackBtn = document.getElementById('accountBackBtn');
  const roleBackBtn = document.getElementById('roleBackBtn');
  const customizationBackBtn = document.getElementById('customizationBackBtn');
  const goToRoleBtn = document.getElementById('goToRoleBtn');
  const goToCustomizationBtn = document.getElementById('goToCustomizationBtn');

  const dropdownAccountLink = document.getElementById('dropdownAccountLink');
  const dropdownRoleLink = document.getElementById('dropdownRoleLink');
  const dropdownPreferencesLink = document.getElementById('dropdownPreferencesLink');
  const headerPageTitle = document.getElementById('headerPageTitle');

  function switchView(targetKey, titleText, updateHash = true) {
    if (!views[targetKey]) return;

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

    const title = titleText || viewTitles[targetKey] || 'Teapot';
    if (headerPageTitle) {
      headerPageTitle.textContent = title;
    }

    if (updateHash) {
      const hashKey = targetKey === 'accountSettings' ? 'settings' : (targetKey === 'startMeeting' ? 'meeting' : (targetKey === 'aroundGlobe' ? 'globe' : targetKey));
      if (window.location.hash !== `#${hashKey}`) {
        window.location.hash = hashKey;
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleHashNavigation() {
    const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
    const routeMap = {
      '': 'home',
      'home': 'home',
      'meeting': 'startMeeting',
      'startmeeting': 'startMeeting',
      'globe': 'aroundGlobe',
      'aroundglobe': 'aroundGlobe',
      'settings': 'accountSettings',
      'accountsettings': 'accountSettings',
      'account': 'accountSettings',
      'role': 'role',
      'roles': 'role',
      'customization': 'customization',
      'preferences': 'customization'
    };
    const targetKey = routeMap[rawHash] || 'home';
    switchView(targetKey, viewTitles[targetKey], false);
  }

  window.addEventListener('hashchange', handleHashNavigation);

  if (jumpConversationLink) {
    jumpConversationLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('startMeeting', viewTitles.startMeeting);
    });
  }

  if (navJumpLink) {
    navJumpLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('startMeeting', viewTitles.startMeeting);
    });
  }

  if (navHomeLink) {
    navHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home', viewTitles.home);
    });
  }

  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home', viewTitles.home);
    });
  }

  if (aroundGlobeBackBtn) {
    aroundGlobeBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('startMeeting', viewTitles.startMeeting);
    });
  }

  if (accountBackBtn) {
    accountBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home', viewTitles.home);
    });
  }

  if (roleBackBtn) {
    roleBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('accountSettings', viewTitles.accountSettings);
    });
  }

  if (customizationBackBtn) {
    customizationBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('accountSettings', viewTitles.accountSettings);
    });
  }

  if (goToRoleBtn) {
    goToRoleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('role', viewTitles.role);
    });
  }

  if (goToCustomizationBtn) {
    goToCustomizationBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('customization', viewTitles.customization);
    });
  }

  if (dropdownAccountLink) {
    dropdownAccountLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('accountSettings', viewTitles.accountSettings);
    });
  }

  if (dropdownRoleLink) {
    dropdownRoleLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('role', viewTitles.role);
    });
  }

  if (dropdownPreferencesLink) {
    dropdownPreferencesLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('customization', viewTitles.customization);
    });
  }

  window.__teapotSwitchView = switchView;

  // Execute initial routing if hash is present
  if (window.location.hash) {
    handleHashNavigation();
  }
}

/**
 * Controls for Jump into Conversation & Around the Globe (WebRTC Video Conferencing + Pre-Join Workflow)
 */
function initMeetingControls() {
  const aroundGlobeCard = document.getElementById('aroundGlobeCard');
  const aroundTableCard = document.getElementById('aroundTableCard');
  const jumpOptionFeedback = document.getElementById('jumpOptionFeedback');

  const aroundGlobeForm = document.getElementById('aroundGlobeForm');
  const globeCodeInput = document.getElementById('globeCodeInput');
  const globeFeedback = document.getElementById('globeFeedback');

  const webrtcJoinCard = document.getElementById('webrtcJoinCard');
  const preJoinCard = document.getElementById('preJoinCard');
  const preJoinRoomCodeLabel = document.getElementById('preJoinRoomCodeLabel');
  const preJoinVideo = document.getElementById('preJoinVideo');
  const preJoinCameraOffPlaceholder = document.getElementById('preJoinCameraOffPlaceholder');
  const preJoinToggleMicBtn = document.getElementById('preJoinToggleMicBtn');
  const preJoinMicIcon = document.getElementById('preJoinMicIcon');
  const preJoinMicStatusText = document.getElementById('preJoinMicStatusText');
  const preJoinToggleCamBtn = document.getElementById('preJoinToggleCamBtn');
  const preJoinCamIcon = document.getElementById('preJoinCamIcon');
  const preJoinCamStatusText = document.getElementById('preJoinCamStatusText');
  const preJoinCancelBtn = document.getElementById('preJoinCancelBtn');
  const preJoinConfirmBtn = document.getElementById('preJoinConfirmBtn');
  const preJoinFeedback = document.getElementById('preJoinFeedback');

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
  const toggleTranscriptionBtn = document.getElementById('toggleTranscriptionBtn');
  const transcriptionBtnIcon = document.getElementById('transcriptionBtnIcon');
  const transcriptionStatus = document.getElementById('transcriptionStatus');
  const manualTranscriptInput = document.getElementById('manualTranscriptInput');
  const sendManualTranscriptBtn = document.getElementById('sendManualTranscriptBtn');
  const transcriptEvents = document.getElementById('transcriptEvents');
  const partialTranscriptLines = new Map();

  let preJoinMicOn = false; // Default: muted / off
  let preJoinCamOn = false; // Default: camera off
  let preJoinPreviewStream = null;

  if (aroundGlobeCard) {
    aroundGlobeCard.addEventListener('click', () => {
      if (window.__teapotSwitchView) {
        window.__teapotSwitchView('aroundGlobe', 'Around the Globe');
      }
    });
  }

  if (aroundTableCard && jumpOptionFeedback) {
    aroundTableCard.addEventListener('click', async () => {
      jumpOptionFeedback.classList.remove('d-none');
      jumpOptionFeedback.className = 'sidebar-status-msg status-empty mt-4';
      jumpOptionFeedback.replaceChildren();
      
      const icon = document.createElement('i');
      icon.className = 'spinner-border spinner-border-sm me-2';
      const span = document.createElement('span');
      span.textContent = 'Creating new meeting session...';
      
      jumpOptionFeedback.appendChild(icon);
      jumpOptionFeedback.appendChild(span);

      try {
        if (rtcClient?.roomId) {
          try { rtcClient.disconnect(); } catch (error) { console.warn('Resetting previous meeting failed:', error); }
          rtcClient = null;
        }
        if (!rtcClient || !rtcClient.ws || rtcClient.ws.readyState !== WebSocket.OPEN) {
          if (rtcClient) {
            try { rtcClient.disconnect(); } catch (error) { console.warn('Resetting stale signaling client failed:', error); }
          }
          rtcClient = new WebRTCClient({ baseUrl: API_CONFIG.BASE_URL });
          const localPeerId = await rtcClient.connectSignaling();
          rtcClient.peerId = localPeerId;
        }

        const res = await fetch(`${API_CONFIG.BASE_URL}/rtc/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host_peer_id: rtcClient.peerId,
            host_display_name: appState.account.displayName
          })
        });

        if (!res.ok) throw new Error('Failed to create session');
        
        const data = await res.json();
        const session = data.session;
        
        // Hide start view, go to preJoinCard
        const startMeetingView = document.getElementById('startMeetingView');
        if (startMeetingView) startMeetingView.classList.add('d-none');
        if (preJoinCard) preJoinCard.classList.remove('d-none');

        // Store session info globally or on the UI
        globeCodeInput.dataset.sessionId = session.session_id;
        globeCodeInput.dataset.meetingCode = session.meeting_code;
        globeCodeInput.dataset.isHost = 'true';
        globeCodeInput.dataset.hostToken = data.host_token;
        
        if (preJoinRoomCodeLabel) preJoinRoomCodeLabel.textContent = `Meeting Code: ${session.meeting_code}`;
        
        // Reset pre-join settings
        preJoinMicOn = false;
        preJoinCamOn = false;
        updatePreJoinMicUI();
        updatePreJoinCamUI();
        
      } catch (err) {
        jumpOptionFeedback.className = 'sidebar-status-msg status-error mt-4';
        jumpOptionFeedback.replaceChildren();
        const errIcon = document.createElement('i');
        errIcon.className = 'bi bi-exclamation-triangle-fill';
        const errSpan = document.createElement('span');
        errSpan.textContent = 'Could not create meeting. ' + err.message;
        jumpOptionFeedback.appendChild(errIcon);
        jumpOptionFeedback.appendChild(errSpan);
      }
    });
  }

  // Pre-join Microphone Toggle
  if (preJoinToggleMicBtn) {
    preJoinToggleMicBtn.addEventListener('click', () => {
      preJoinMicOn = !preJoinMicOn;
      updatePreJoinMicUI();
    });
  }

  function updatePreJoinMicUI() {
    if (preJoinMicOn) {
      if (preJoinMicIcon) preJoinMicIcon.className = 'bi bi-mic-fill text-success';
      if (preJoinMicStatusText) preJoinMicStatusText.textContent = 'Microphone On';
    } else {
      if (preJoinMicIcon) preJoinMicIcon.className = 'bi bi-mic-mute-fill text-muted';
      if (preJoinMicStatusText) preJoinMicStatusText.textContent = 'Microphone Off';
    }
  }

  // Pre-join Camera Toggle
  if (preJoinToggleCamBtn) {
    preJoinToggleCamBtn.addEventListener('click', async () => {
      preJoinCamOn = !preJoinCamOn;
      await updatePreJoinCamUI();
    });
  }

  async function updatePreJoinCamUI() {
    if (preJoinCamOn) {
      if (preJoinCamIcon) preJoinCamIcon.className = 'bi bi-camera-video-fill text-success';
      if (preJoinCamStatusText) preJoinCamStatusText.textContent = 'Camera On';

      try {
        if (!preJoinPreviewStream) {
          preJoinPreviewStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        if (preJoinVideo) {
          preJoinVideo.srcObject = preJoinPreviewStream;
          preJoinVideo.classList.remove('d-none');
        }
        if (preJoinCameraOffPlaceholder) preJoinCameraOffPlaceholder.classList.add('d-none');
      } catch (err) {
        console.warn('Pre-join camera access error/denied:', err);
        if (preJoinFeedback) {
          preJoinFeedback.classList.remove('d-none');
          preJoinFeedback.className = 'sidebar-status-msg status-warning mt-3';
          preJoinFeedback.textContent = 'Camera preview unavailable or permission denied.';
        }
      }
    } else {
      if (preJoinCamIcon) preJoinCamIcon.className = 'bi bi-camera-video-off-fill text-muted';
      if (preJoinCamStatusText) preJoinCamStatusText.textContent = 'Camera Off';

      stopPreJoinPreviewStream();
      if (preJoinVideo) {
        preJoinVideo.srcObject = null;
        preJoinVideo.classList.add('d-none');
      }
      if (preJoinCameraOffPlaceholder) preJoinCameraOffPlaceholder.classList.remove('d-none');
    }
  }

  function stopPreJoinPreviewStream() {
    if (preJoinPreviewStream) {
      preJoinPreviewStream.getTracks().forEach(track => track.stop());
      preJoinPreviewStream = null;
    }
  }

  // Room Code Form Submit -> Opens Pre-Join Screen if Valid Code
  if (aroundGlobeForm && globeCodeInput) {
    aroundGlobeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = globeCodeInput.value.trim();

      if (!code) {
        showGlobeError('Please enter a meeting code before joining.');
        return;
      }

      if (globeFeedback) {
        globeFeedback.classList.remove('d-none');
        globeFeedback.className = 'sidebar-status-msg status-empty mt-3';
        globeFeedback.textContent = 'Verifying meeting code...';
      }

      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/rtc/sessions/by-code/${code}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Meeting not found.');
          if (res.status === 410) throw new Error('This meeting has already ended.');
          throw new Error('Error verifying meeting.');
        }
        
        const session = await res.json();
        if (globeFeedback) globeFeedback.classList.add('d-none');
        
        // Store session info
        globeCodeInput.dataset.sessionId = session.session_id;
        globeCodeInput.dataset.meetingCode = session.meeting_code;
        globeCodeInput.dataset.isHost = 'false';

        // Open Pre-Join Card with room ID preserved
        if (preJoinRoomCodeLabel) preJoinRoomCodeLabel.textContent = `Room: ${session.meeting_code}`;
        if (webrtcJoinCard) webrtcJoinCard.classList.add('d-none');
        if (preJoinCard) preJoinCard.classList.remove('d-none');

        // Reset pre-join settings to defaults: Mic Off, Cam Off
        preJoinMicOn = false;
        preJoinCamOn = false;
        updatePreJoinMicUI();
        updatePreJoinCamUI();

      } catch (err) {
        showGlobeError(err.message);
      }
    });
  }

  function showGlobeError(msg) {
    if (globeFeedback) {
      globeFeedback.classList.remove('d-none');
      globeFeedback.className = 'sidebar-status-msg status-error mt-3';
      globeFeedback.replaceChildren();
      const icon = document.createElement('i');
      icon.className = 'bi bi-exclamation-triangle-fill';
      const span = document.createElement('span');
      span.textContent = msg;
      globeFeedback.appendChild(icon);
      globeFeedback.appendChild(span);
    }
  }

  // Pre-join Cancel / Back Button -> Return to Code Entry Card with code preserved
  if (preJoinCancelBtn) {
    preJoinCancelBtn.addEventListener('click', () => {
      stopPreJoinPreviewStream();
      if (preJoinCard) preJoinCard.classList.add('d-none');
      if (webrtcJoinCard) webrtcJoinCard.classList.remove('d-none');
      if (preJoinFeedback) preJoinFeedback.classList.add('d-none');
    });
  }

  // Pre-join Confirm Button ("Join Conversation")
  if (preJoinConfirmBtn && globeCodeInput) {
    preJoinConfirmBtn.addEventListener('click', async () => {
      const sessionId = globeCodeInput.dataset.sessionId;
      const meetingCode = globeCodeInput.dataset.meetingCode;
      if (!sessionId) return;

      stopPreJoinPreviewStream();

      try {
        if (preJoinFeedback) {
          preJoinFeedback.classList.remove('d-none');
          preJoinFeedback.className = 'sidebar-status-msg status-empty mt-3';
          preJoinFeedback.textContent = 'Connecting to WebRTC meeting session...';
        }

        const admissionContainer = document.getElementById('admissionRequestsContainer');
        if (admissionContainer) admissionContainer.replaceChildren();

        // Initialize WebRTC client if not already connected
        if (!rtcClient) {
          rtcClient = new WebRTCClient({ baseUrl: API_CONFIG.BASE_URL });
        }
        
        // Setup callbacks
        rtcClient.onStatusChange = (statusText) => {
          if (webrtcStatusLabel) webrtcStatusLabel.textContent = `Status: ${statusText}`;
          if (/reconnect/i.test(statusText)) transcriptTree?.setStatus('Reconnecting');
          else if (/disconnect/i.test(statusText)) transcriptTree?.setStatus('Disconnected');
          else if (/connect/i.test(statusText)) transcriptTree?.setStatus('Connecting');
          if (/connected|joined/i.test(statusText)) {
            clearTimeout(treeStaleTimer);
            treeStaleTimer = setTimeout(() => transcriptTree?.setStatus('Stale'), 30000);
          }
        };
        rtcClient.onMeetingState = (state) => {
          hasLiveMeetingState = true;
          transcriptTree?.applyState(state);
          clearTimeout(treeStaleTimer);
          if (state.meeting_status !== 'completed') {
            treeStaleTimer = setTimeout(() => transcriptTree?.setStatus('Stale'), 30000);
          }
        };
        rtcClient.onPeerJoined = (peerId) => {
          updatePeerCountBadge();
        };
        rtcClient.onPeerLeft = (peerId) => {
          removeRemoteVideoTile(peerId);
          updatePeerCountBadge();
        };
        rtcClient.onRemoteTrack = (peerId, stream) => {
          addOrUpdateRemoteVideoTile(peerId, stream);
        };
        rtcClient.onTranscript = (event) => {
          if (!event) return;
          transcriptTree?.ingestTranscriptEvent(event);
          clearTimeout(treeStaleTimer);
          treeStaleTimer = setTimeout(() => transcriptTree?.setStatus('Stale'), 30000);
          if (!transcriptEvents) return;
          if (transcriptEvents.textContent === 'No transcript events yet.') transcriptEvents.replaceChildren();
          const key = `${event.participant_id}:${event.session_id}:${event.sequence_number}`;
          const existingPartial = partialTranscriptLines.get(key);
          if (event.event_type === 'final' && existingPartial) {
            existingPartial.remove();
            partialTranscriptLines.delete(key);
          }
          const line = existingPartial && event.event_type === 'partial' ? existingPartial : document.createElement('div');
          line.className = event.event_type === 'partial' ? 'text-secondary fst-italic' : 'text-light';
          line.textContent = `${event.participant_id === rtcClient.peerId ? 'You' : event.participant_id.slice(0, 6)}: ${event.text || event.event_type}`;
          if (!line.parentElement) transcriptEvents.appendChild(line);
          if (event.event_type === 'partial') partialTranscriptLines.set(key, line);
          while (transcriptEvents.children.length > 100) transcriptEvents.firstElementChild.remove();
        };
        rtcClient.onError = (errMsg) => {
          console.warn('WebRTC Error:', errMsg);
          if (preJoinFeedback) {
            preJoinFeedback.classList.remove('d-none');
            preJoinFeedback.className = 'sidebar-status-msg status-error mt-3';
            preJoinFeedback.textContent = 'Error: ' + errMsg;
          }
        };
        rtcClient.onWaitingForHost = () => {
          if (webrtcStatusLabel) webrtcStatusLabel.textContent = 'Waiting for host admission...';
        };
        rtcClient.onJoinRequest = (peerEvent) => {
          // Show admit/reject UI for host
          const reqDiv = document.createElement('div');
          reqDiv.className = 'd-flex align-items-center justify-content-between bg-dark bg-opacity-50 p-2 rounded border border-secondary';
          reqDiv.id = `join-req-${peerEvent.peer_id}`;
          reqDiv.innerHTML = `
            <span class="text-light small"><i class="bi bi-person-fill"></i> ${peerEvent.peer_id} wants to join</span>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-success py-0" id="admit-${peerEvent.peer_id}">Admit</button>
              <button class="btn btn-sm btn-danger py-0" id="reject-${peerEvent.peer_id}">Reject</button>
            </div>
          `;
          if (admissionContainer) {
            admissionContainer.appendChild(reqDiv);
            document.getElementById(`admit-${peerEvent.peer_id}`).addEventListener('click', () => {
              rtcClient.admitPeer(peerEvent.peer_id);
              reqDiv.remove();
            });
            document.getElementById(`reject-${peerEvent.peer_id}`).addEventListener('click', () => {
              rtcClient.rejectPeer(peerEvent.peer_id);
              reqDiv.remove();
            });
          }
        };
        rtcClient.onJoinRejected = (msg) => {
          if (webrtcStatusLabel) webrtcStatusLabel.textContent = 'Rejected by host';
          if (preJoinFeedback) {
            preJoinFeedback.classList.remove('d-none');
            preJoinFeedback.className = 'sidebar-status-msg status-error mt-3';
            preJoinFeedback.textContent = msg;
          }
        };
        rtcClient.onSessionEnded = (msg) => {
          alert('Meeting has ended: ' + msg);
          cleanupAndLeave();
        };
        rtcClient.onRoomInfo = (info) => {
          if (webrtcStatusLabel) {
            webrtcStatusLabel.textContent = info.is_host
              ? 'Status: Connected as host'
              : 'Status: Connected';
          }
          if (conferenceRoomTitle) {
            conferenceRoomTitle.textContent = `Room: ${meetingCode}`;
          }
          const meetingCodeDisplay = document.getElementById('meetingCodeDisplay');
          const meetingCodeText = document.getElementById('meetingCodeText');
          if (meetingCodeDisplay && meetingCodeText) {
            meetingCodeText.textContent = meetingCode;
            meetingCodeDisplay.style.display = 'block';
          }
          if (preJoinCard) preJoinCard.classList.add('d-none');
          if (videoConferenceInterface) videoConferenceInterface.classList.remove('d-none');
          updatePeerCountBadge();
        };

        // 1. Acquire local stream with pre-join mic and camera states
        let stream = null;
        if (preJoinMicOn || preJoinCamOn) {
          try {
            stream = await rtcClient.startLocalStream({ audio: preJoinMicOn, video: preJoinCamOn });
          } catch (mediaError) {
            // Signaling and text transcripts remain usable when this browser
            // cannot expose camera/microphone capture.
            if (rtcClient.localStream) {
              rtcClient.localStream.getTracks().forEach((track) => track.stop());
              rtcClient.localStream = null;
            }
            if (webrtcStatusLabel) webrtcStatusLabel.textContent = 'Status: Connected (text only)';
            if (preJoinFeedback) {
              preJoinFeedback.className = 'sidebar-status-msg status-empty mt-3';
              preJoinFeedback.textContent = `Media unavailable; joining text-only. ${mediaError.message}`;
            }
          }
        } else if (webrtcStatusLabel) {
          webrtcStatusLabel.textContent = 'Status: Connecting (text only)';
        }
        if (localVideo) {
          localVideo.srcObject = stream;
        }

        // Apply audio/video mute state based on pre-join choices
        if (!preJoinMicOn) {
          rtcClient.audioMuted = true;
          if (stream) stream.getAudioTracks().forEach(t => t.enabled = false);
        }
        if (!preJoinCamOn) {
          rtcClient.videoMuted = true;
          if (stream) stream.getVideoTracks().forEach(t => t.enabled = false);
        }

        // 2. Connect signaling WebSocket (if not already) & join room
        if (!rtcClient.ws || rtcClient.ws.readyState !== WebSocket.OPEN) {
          await rtcClient.connectSignaling();
        }
        rtcClient.joinRoom(sessionId, {
          hostToken: globeCodeInput.dataset.isHost === 'true' ? globeCodeInput.dataset.hostToken : null,
          displayName: appState.account.displayName
        });

        // Update In-Call Action Button UI states
        if (toggleAudioBtn) {
          if (!preJoinMicOn) {
            toggleAudioBtn.classList.replace('btn-outline-light', 'btn-warning');
            if (audioBtnIcon) audioBtnIcon.className = 'bi bi-mic-mute-fill fs-5';
          } else {
            toggleAudioBtn.classList.replace('btn-warning', 'btn-outline-light');
            if (audioBtnIcon) audioBtnIcon.className = 'bi bi-mic-fill fs-5';
          }
        }
        if (toggleVideoBtn) {
          if (!preJoinCamOn) {
            toggleVideoBtn.classList.replace('btn-outline-light', 'btn-warning');
            if (videoBtnIcon) videoBtnIcon.className = 'bi bi-camera-video-off-fill fs-5';
          } else {
            toggleVideoBtn.classList.replace('btn-warning', 'btn-outline-light');
            if (videoBtnIcon) videoBtnIcon.className = 'bi bi-camera-video-fill fs-5';
          }
        }

        // Update UI View State
        if (preJoinCard) preJoinCard.classList.add('d-none');
        if (videoConferenceInterface) videoConferenceInterface.classList.remove('d-none');
        if (conferenceRoomTitle) conferenceRoomTitle.textContent = `Room: ${meetingCode}`;
        updatePeerCountBadge();

      } catch (err) {
        console.error('Failed to start WebRTC session:', err);
        if (rtcClient) {
          try {
            if (rtcClient.roomId) rtcClient.leaveRoom();
            else {
              rtcClient.localStream?.getTracks().forEach((track) => track.stop());
              rtcClient.localStream = null;
            }
          } catch (cleanupError) {
            console.warn('Failed to clean up failed join:', cleanupError);
          }
        }
        if (preJoinFeedback) {
          preJoinFeedback.className = 'sidebar-status-msg status-error mt-3';
          preJoinFeedback.textContent = `Joining failed: ${err.message || 'Unable to connect to meeting room.'}`;
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

  // Browser-native ASR is explicit opt-in. Its processing location varies by
  // browser, so the UI exposes that limitation instead of implying offline ASR.
  if (toggleTranscriptionBtn) {
    toggleTranscriptionBtn.addEventListener('click', async () => {
      if (!rtcClient) return;
      if (rtcClient.transcription) {
        rtcClient.stopTranscription();
        toggleTranscriptionBtn.classList.replace('btn-warning', 'btn-outline-light');
        if (transcriptionBtnIcon) transcriptionBtnIcon.className = 'bi bi-file-text fs-5';
        if (transcriptionStatus) transcriptionStatus.textContent = 'Off';
        return;
      }
      const adapter = new BrowserSpeechRecognitionAdapter();
      if (!adapter.isSupported()) {
        if (transcriptionStatus) transcriptionStatus.textContent = 'Use manual transcript input';
        return;
      }
      if (!window.confirm(`${adapter.privacyNotice}\n\nStart text-only transcription?`)) return;
      rtcClient.transcriptionAdapter = adapter;
      const started = await rtcClient.startTranscription();
      if (started !== false) {
        toggleTranscriptionBtn.classList.replace('btn-outline-light', 'btn-warning');
        if (transcriptionBtnIcon) transcriptionBtnIcon.className = 'bi bi-file-text-fill fs-5';
        if (transcriptionStatus) transcriptionStatus.textContent = 'On (browser ASR)';
      } else if (transcriptionStatus) {
        transcriptionStatus.textContent = 'Unavailable';
      }
    });
  }

  if (sendManualTranscriptBtn) {
    sendManualTranscriptBtn.addEventListener('click', () => {
      const text = manualTranscriptInput?.value.trim();
      if (!text) return;
      if (!rtcClient?.sendManualTranscript(text)) {
        if (transcriptionStatus) transcriptionStatus.textContent = 'Join the meeting first';
        return;
      }
      manualTranscriptInput.value = '';
      if (transcriptionStatus) transcriptionStatus.textContent = 'Manual transcript on';
    });
  }

  // Leave Call Button
  if (leaveCallBtn) {
    leaveCallBtn.addEventListener('click', async () => {
      const sessionId = globeCodeInput?.dataset?.sessionId;
      const isHost = globeCodeInput?.dataset?.isHost === 'true';

      if (isHost && sessionId) {
        // If host, end the entire session
        try {
          await fetch(`${API_CONFIG.BASE_URL}/rtc/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peer_id: rtcClient?.peerId, host_token: globeCodeInput.dataset.hostToken })
          });
        } catch (e) {
          console.error('Failed to end session', e);
        }
      }

      cleanupAndLeave();
    });
  }

  function cleanupAndLeave() {
    if (rtcClient) {
      try { rtcClient.leaveRoom(); } catch (e) {}
      try { rtcClient.disconnect(); } catch (e) {}
      rtcClient = null;
    }
    // Reset UI elements
    if (videoConferenceInterface) videoConferenceInterface.classList.add('d-none');
    if (webrtcJoinCard) webrtcJoinCard.classList.remove('d-none');
    
    // Hide meeting code display
    const meetingCodeDisplay = document.getElementById('meetingCodeDisplay');
    if (meetingCodeDisplay) meetingCodeDisplay.style.display = 'none';
    
    if (localVideo) localVideo.srcObject = null;
    if (transcriptEvents) {
      transcriptEvents.replaceChildren();
      transcriptEvents.textContent = 'No transcript events yet.';
    }
    partialTranscriptLines.clear();
    transcriptTree?.reset();
    hasLiveMeetingState = false;
    clearTimeout(treeStaleTimer);
    if (transcriptionStatus) transcriptionStatus.textContent = 'Off';
    // Remove remote videos
    document.querySelectorAll('.remote-video-tile').forEach(tile => tile.remove());
    // Remove admission requests
    const admissionContainer = document.getElementById('admissionRequestsContainer');
    if (admissionContainer) admissionContainer.replaceChildren();
    
    // Clear dataset
    if (globeCodeInput) {
      delete globeCodeInput.dataset.sessionId;
      delete globeCodeInput.dataset.meetingCode;
      delete globeCodeInput.dataset.isHost;
      delete globeCodeInput.dataset.hostToken;
    }
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

  const nameInput = document.getElementById('settingDisplayName');
  const emailInput = document.getElementById('settingEmail');
  const roleInput = document.getElementById('settingRole');
  const languageSelect = document.getElementById('settingLanguage');

  // Populate form controls from appState
  if (nameInput) nameInput.value = appState.account.displayName || '';
  if (emailInput) emailInput.value = appState.account.email || '';
  if (roleInput) roleInput.value = appState.account.role || '';
  if (languageSelect) languageSelect.value = appState.account.language || 'en-US';

  const summaryRadio = document.querySelector(`input[name="summaryLength"][value="${appState.account.summaryLength}"]`);
  if (summaryRadio) summaryRadio.checked = true;

  if (document.getElementById('insightDecisions')) document.getElementById('insightDecisions').checked = !!appState.account.insights.decisions;
  if (document.getElementById('insightTasks')) document.getElementById('insightTasks').checked = !!appState.account.insights.tasks;
  if (document.getElementById('insightRisks')) document.getElementById('insightRisks').checked = !!appState.account.insights.risks;
  if (document.getElementById('insightSuggestions')) document.getElementById('insightSuggestions').checked = !!appState.account.insights.suggestions;

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      if (nameInput) appState.account.displayName = nameInput.value.trim();
      if (emailInput) appState.account.email = emailInput.value.trim();
      if (roleInput) appState.account.role = roleInput.value.trim();
      if (languageSelect) appState.account.language = languageSelect.value;

      const summaryLengthRadio = document.querySelector('input[name="summaryLength"]:checked');
      if (summaryLengthRadio) appState.account.summaryLength = summaryLengthRadio.value;

      appState.account.insights.decisions = document.getElementById('insightDecisions')?.checked || false;
      appState.account.insights.tasks = document.getElementById('insightTasks')?.checked || false;
      appState.account.insights.risks = document.getElementById('insightRisks')?.checked || false;
      appState.account.insights.suggestions = document.getElementById('insightSuggestions')?.checked || false;

      try {
        localStorage.setItem(STORAGE_KEYS.ACCOUNT, JSON.stringify(appState.account));
      } catch (err) {
        console.warn('Failed to save account settings to localStorage', err);
      }

      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();

        const icon = document.createElement('i');
        icon.className = 'bi bi-check-circle-fill text-success';
        const span = document.createElement('span');
        span.textContent = 'Account settings saved successfully.';

        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
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

      appState.account.displayName = 'Jane Doe';
      appState.account.email = 'jane.doe@example.com';
      appState.account.role = 'Product Manager';
      appState.account.language = 'en-US';
      appState.account.summaryLength = 'balanced';
      appState.account.insights = {
        decisions: true,
        tasks: true,
        risks: false,
        suggestions: true
      };

      try {
        localStorage.setItem(STORAGE_KEYS.ACCOUNT, JSON.stringify(appState.account));
      } catch (err) {
        console.warn('Failed to save account settings to localStorage', err);
      }

      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();

        const icon = document.createElement('i');
        icon.className = 'bi bi-info-circle';
        const span = document.createElement('span');
        span.textContent = 'Account settings restored to defaults.';

        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
  }
}

/**
 * Dedicated Role View Handler & State Management
 */
function initRoleManagement() {
  const userRoleDescription = document.getElementById('userRoleDescription');
  const saveUserRoleBtn = document.getElementById('saveUserRoleBtn');
  const editUserRoleBtn = document.getElementById('editUserRoleBtn');
  const cancelUserRoleBtn = document.getElementById('cancelUserRoleBtn');
  const userRoleFeedback = document.getElementById('userRoleFeedback');
  const addRolePointBtn = document.getElementById('addRolePointBtn');
  const rolePointsList = document.getElementById('rolePointsList');
  const rolePointsStatus = document.getElementById('rolePointsStatus');

  let savedDescriptionTemp = '';

  function saveRoleStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.ROLE, JSON.stringify({
        roleDescription: appState.account.roleDescription,
        rolePoints: appState.account.rolePoints.map((p) => ({ id: p.id, text: p.text }))
      }));
    } catch (e) {
      console.warn('Failed to save role to localStorage', e);
    }
  }

  // Initialize Role Description in UI
  if (userRoleDescription) {
    userRoleDescription.value = appState.account.roleDescription || '';
    if (appState.account.roleDescription) {
      userRoleDescription.disabled = true;
      if (saveUserRoleBtn) saveUserRoleBtn.classList.add('d-none');
      if (editUserRoleBtn) editUserRoleBtn.classList.remove('d-none');
    }
  }

  // Save Role Description handler
  if (saveUserRoleBtn && userRoleDescription) {
    saveUserRoleBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const textVal = userRoleDescription.value.trim();

      if (!textVal) {
        if (userRoleFeedback) {
          userRoleFeedback.classList.remove('d-none');
          userRoleFeedback.className = 'sidebar-status-msg status-error mt-2 mb-3';
          userRoleFeedback.replaceChildren();
          const icon = document.createElement('i');
          icon.className = 'bi bi-exclamation-triangle-fill';
          const span = document.createElement('span');
          span.textContent = 'Please enter a description of your role or evaluation objectives.';
          userRoleFeedback.appendChild(icon);
          userRoleFeedback.appendChild(span);
        }
        return;
      }

      appState.account.roleDescription = textVal;
      userRoleDescription.disabled = true;

      if (saveUserRoleBtn) saveUserRoleBtn.classList.add('d-none');
      if (editUserRoleBtn) editUserRoleBtn.classList.remove('d-none');
      if (cancelUserRoleBtn) cancelUserRoleBtn.classList.add('d-none');

      saveRoleStorage();

      if (userRoleFeedback) {
        userRoleFeedback.classList.remove('d-none');
        userRoleFeedback.className = 'sidebar-status-msg status-empty mt-2 mb-3';
        userRoleFeedback.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'bi bi-check-circle-fill text-success';
        const span = document.createElement('span');
        span.textContent = 'Role description saved successfully.';
        userRoleFeedback.appendChild(icon);
        userRoleFeedback.appendChild(span);
      }

      if (API_CONFIG.ROLE_ENDPOINT) {
        try {
          const res = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ROLE_ENDPOINT}`, {
            method: 'POST',
            headers: API_CONFIG.HEADERS,
            body: JSON.stringify({ roleDescription: textVal })
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.points)) {
              appState.account.rolePoints = data.points.map((p, idx) => ({
                id: p.id || `point-${Date.now()}-${idx}`,
                text: typeof p === 'string' ? p : (p.text || p.label || ''),
                isEditing: false
              }));
              renderRolePointsList();
              saveRoleStorage();
            }
          }
        } catch (err) {
          console.warn('Backend role processing unavailable:', err);
        }
      }
    });
  }

  // Edit Role Description handler
  if (editUserRoleBtn && userRoleDescription) {
    editUserRoleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      savedDescriptionTemp = appState.account.roleDescription;
      userRoleDescription.disabled = false;
      userRoleDescription.focus();

      if (saveUserRoleBtn) saveUserRoleBtn.classList.remove('d-none');
      if (editUserRoleBtn) editUserRoleBtn.classList.add('d-none');
      if (cancelUserRoleBtn) cancelUserRoleBtn.classList.remove('d-none');
      if (userRoleFeedback) userRoleFeedback.classList.add('d-none');
    });
  }

  // Cancel Role Description editing handler
  if (cancelUserRoleBtn && userRoleDescription) {
    cancelUserRoleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      userRoleDescription.value = savedDescriptionTemp;
      userRoleDescription.disabled = true;

      if (saveUserRoleBtn) saveUserRoleBtn.classList.add('d-none');
      if (editUserRoleBtn) editUserRoleBtn.classList.remove('d-none');
      if (cancelUserRoleBtn) cancelUserRoleBtn.classList.add('d-none');
      if (userRoleFeedback) userRoleFeedback.classList.add('d-none');
    });
  }

  // Add Point handler
  if (addRolePointBtn) {
    addRolePointBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const newId = `role-point-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      appState.account.rolePoints.push({
        id: newId,
        text: '',
        isEditing: true
      });
      renderRolePointsList();
    });
  }

  // Render Role Points List safely
  function renderRolePointsList() {
    if (!rolePointsList) return;
    rolePointsList.replaceChildren();

    if (!appState.account.rolePoints || appState.account.rolePoints.length === 0) {
      if (rolePointsStatus) {
        rolePointsStatus.classList.remove('d-none');
        rolePointsStatus.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'bi bi-info-circle';
        const span = document.createElement('span');
        span.textContent = 'No evaluation points configured yet. Add points manually or save a role description.';
        rolePointsStatus.appendChild(icon);
        rolePointsStatus.appendChild(span);
      }
      return;
    }

    if (rolePointsStatus) rolePointsStatus.classList.add('d-none');

    appState.account.rolePoints.forEach((item, index) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'role-point-item';

      if (item.isEditing) {
        // Edit Mode for individual point with responsive wrapper
        const editGroup = document.createElement('div');
        editGroup.className = 'role-point-edit-group';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control form-control-sm';
        input.value = item.text;
        input.placeholder = 'Enter evaluation point or key criteria...';

        const editButtons = document.createElement('div');
        editButtons.className = 'role-point-edit-buttons';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'btn btn-sm btn-primary-custom text-nowrap';
        saveBtn.innerHTML = '<i class="bi bi-check-lg"></i> Save';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-sm btn-secondary-custom text-nowrap';
        cancelBtn.innerHTML = '<i class="bi bi-x-lg"></i> Cancel';

        saveBtn.addEventListener('click', () => {
          const val = input.value.trim();
          if (!val) {
            alert('Point text cannot be empty or whitespace only.');
            return;
          }
          item.text = val;
          item.isEditing = false;
          renderRolePointsList();
          saveRoleStorage();
        });

        cancelBtn.addEventListener('click', () => {
          if (!item.text) {
            appState.account.rolePoints.splice(index, 1);
          } else {
            item.isEditing = false;
          }
          renderRolePointsList();
        });

        editGroup.appendChild(input);
        editButtons.appendChild(saveBtn);
        editButtons.appendChild(cancelBtn);
        editGroup.appendChild(editButtons);
        itemDiv.appendChild(editGroup);

        setTimeout(() => input.focus(), 50);

      } else {
        // Normal Display Mode for individual point
        const span = document.createElement('span');
        span.className = 'role-point-text';
        span.textContent = item.text;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'role-point-actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-sm btn-secondary-custom';
        editBtn.innerHTML = '<i class="bi bi-pencil"></i> Edit';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-sm btn-outline-danger';
        deleteBtn.innerHTML = '<i class="bi bi-trash"></i> Delete';

        editBtn.addEventListener('click', () => {
          item.isEditing = true;
          renderRolePointsList();
        });

        deleteBtn.addEventListener('click', () => {
          if (confirm('Are you sure you want to delete this focus point?')) {
            appState.account.rolePoints.splice(index, 1);
            renderRolePointsList();
            saveRoleStorage();
          }
        });

        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(deleteBtn);

        itemDiv.appendChild(span);
        itemDiv.appendChild(btnGroup);
      }

      rolePointsList.appendChild(itemDiv);
    });
  }

  // Initial render of points list
  renderRolePointsList();
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

  function saveCustomizationStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOMIZATION, JSON.stringify(appState.customization));
    } catch (e) {
      console.warn('Failed to save customization to localStorage', e);
    }
  }

  function renderPrioritiesControls() {
    const container = document.getElementById('prioritiesContainer');
    if (!container) return;

    container.replaceChildren();

    appState.customization.priorities.forEach((item) => {
      const col = document.createElement('div');
      col.className = 'col-12 col-sm-6';

      const checkDiv = document.createElement('div');
      checkDiv.className = 'form-check';

      const input = document.createElement('input');
      input.className = 'form-check-input';
      input.type = 'checkbox';
      input.id = `priority_${item.id}`;
      input.checked = !!item.enabled;

      input.addEventListener('change', () => {
        item.enabled = input.checked;
        saveCustomizationStorage();
      });

      const label = document.createElement('label');
      label.className = 'form-check-label small fw-medium text-primary';
      label.htmlFor = `priority_${item.id}`;
      label.textContent = item.label;

      checkDiv.appendChild(input);
      checkDiv.appendChild(label);
      col.appendChild(checkDiv);
      container.appendChild(col);
    });
  }

  function syncApproachControlsFromState() {
    const approachKeys = ['clarifying', 'followup', 'disagree', 'negotiation', 'uncover_risks', 'evidence', 'objections', 'responses'];
    approachKeys.forEach((key) => {
      const el = document.getElementById(`approach_${key}`);
      if (el) {
        el.checked = !!appState.customization.approach[key];
      }
    });

    const styleVal = appState.customization.responseStyle || 'diplomatic';
    const styleRadio = document.querySelector(`input[name="responseStyle"][value="${styleVal}"]`);
    if (styleRadio) {
      styleRadio.checked = true;
    }
    updateResponseStyleSelection();
  }

  function resetSectionA() {
    appState.customization.priorities.forEach((item) => {
      item.enabled = true;
    });
    renderPrioritiesControls();
    saveCustomizationStorage();
  }

  function resetSectionB() {
    const defaultB = {
      clarifying: true,
      followup: true,
      disagree: false,
      negotiation: false,
      uncover_risks: false,
      evidence: false,
      objections: false,
      responses: true
    };
    Object.assign(appState.customization.approach, defaultB);
    appState.customization.responseStyle = 'diplomatic';

    syncApproachControlsFromState();
    saveCustomizationStorage();
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
    radio.addEventListener('change', () => {
      updateResponseStyleSelection();
      appState.customization.responseStyle = radio.value;
      saveCustomizationStorage();
    });
  });

  // Render initial controls
  renderPrioritiesControls();
  syncApproachControlsFromState();

  if (resetSectionABtn) {
    resetSectionABtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetSectionA();
      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'bi bi-info-circle';
        const span = document.createElement('span');
        span.textContent = 'Priorities restored to default values.';
        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
  }

  if (resetSectionBBtn) {
    resetSectionBBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetSectionB();
      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'bi bi-info-circle';
        const span = document.createElement('span');
        span.textContent = 'Conversation approach restored to default values.';
        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
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

      // Sync priorities object state from DOM inputs
      appState.customization.priorities.forEach((item) => {
        const el = document.getElementById(`priority_${item.id}`);
        if (el) item.enabled = el.checked;
      });

      const approachKeys = ['clarifying', 'followup', 'disagree', 'negotiation', 'uncover_risks', 'evidence', 'objections', 'responses'];
      approachKeys.forEach((key) => {
        const el = document.getElementById(`approach_${key}`);
        if (el) appState.customization.approach[key] = el.checked;
      });

      const styleRadio = document.querySelector('input[name="responseStyle"]:checked');
      if (styleRadio) appState.customization.responseStyle = styleRadio.value;

      saveCustomizationStorage();

      if (feedback) {
        feedback.classList.remove('d-none');
        feedback.className = 'sidebar-status-msg status-empty mt-3';
        feedback.replaceChildren();

        const icon = document.createElement('i');
        icon.className = 'bi bi-check-circle-fill text-success';
        const span = document.createElement('span');
        span.textContent = 'Customization priorities and conversation approach saved.';

        feedback.appendChild(icon);
        feedback.appendChild(span);
      }
    });
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
