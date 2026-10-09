/**
 * Main Application Module (Editorial Workspace)
 * Handles client-side UI interactions, view navigation, settings state management, and AJAX conversation history fetching.
 */

import { API_CONFIG, UI_MESSAGES } from './modules/constants.js';

// Local session state container for frontend prototype demonstration
const appState = {
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
  initSidebarToggle();
  initViewNavigation();
  initMeetingControls();
  initAccountSettings();
  initCustomizationControls();
  fetchConversationsHistory();
});

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
 * Single-Page View Navigation (Home, Start Meeting, Account Settings, Customization)
 */
function initViewNavigation() {
  const views = {
    home: document.getElementById('homeView'),
    startMeeting: document.getElementById('startMeetingView'),
    accountSettings: document.getElementById('accountSettingsView'),
    customization: document.getElementById('customizationView')
  };

  const navHomeLink = document.getElementById('navHomeLink');
  const startMeetingBtn = document.getElementById('startMeetingBtn');
  const backToHomeBtn = document.getElementById('backToHomeBtn');
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

    if (navHomeLink) {
      if (targetKey === 'home') {
        navHomeLink.classList.add('active');
      } else {
        navHomeLink.classList.remove('active');
      }
    }

    if (headerPageTitle && titleText) {
      headerPageTitle.textContent = titleText;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (startMeetingBtn) {
    startMeetingBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('startMeeting', 'Start Meeting');
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
}

/**
 * Controls & Validation for Start Meeting Page
 */
function initMeetingControls() {
  const createMeetingBtn = document.getElementById('createMeetingBtn');
  const createMeetingFeedback = document.getElementById('createMeetingFeedback');

  const joinMeetingForm = document.getElementById('joinMeetingForm');
  const meetingCodeInput = document.getElementById('meetingCodeInput');
  const joinMeetingFeedback = document.getElementById('joinMeetingFeedback');

  if (createMeetingBtn && createMeetingFeedback) {
    createMeetingBtn.addEventListener('click', () => {
      createMeetingFeedback.classList.remove('d-none');
    });
  }

  if (joinMeetingForm && meetingCodeInput && joinMeetingFeedback) {
    joinMeetingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const codeValue = meetingCodeInput.value.trim();

      joinMeetingFeedback.classList.remove('d-none');
      joinMeetingFeedback.replaceChildren();

      const icon = document.createElement('i');
      const span = document.createElement('span');

      if (!codeValue) {
        joinMeetingFeedback.className = 'sidebar-status-msg status-error mt-3';
        icon.className = 'bi bi-exclamation-triangle-fill';
        span.textContent = 'Please enter a meeting code or link before joining.';
      } else {
        joinMeetingFeedback.className = 'sidebar-status-msg status-empty mt-3';
        icon.className = 'bi bi-info-circle';
        span.textContent = 'Joining will be available once the meeting service is connected.';
      }

      joinMeetingFeedback.appendChild(icon);
      joinMeetingFeedback.appendChild(span);
    });
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
        span.textContent = 'Account settings saved for local session. Cloud sync will connect when backend service is online.';

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
  }

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

    const conversations = Array.isArray(data) 
      ? data 
      : (data && Array.isArray(data.conversations) ? data.conversations : []);

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
 * @param {HTMLElement} container 
 * @param {string} text 
 * @param {string} statusClass 
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
 * @param {HTMLElement} container 
 * @param {Array} conversations 
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



