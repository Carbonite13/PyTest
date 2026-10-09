/**
 * Shared Application Constants
 * Dedicated constants module for API configuration and UI state messages.
 */

// API Configuration Constants
export const API_CONFIG = {
  // Base URL for API requests
  // Empty means same-origin when the UI is served by FastAPI. Deployments can
  // override this at build time or pass baseUrl to WebRTCClient.
  BASE_URL: '',
  // Endpoint for retrieving past conversation history
  CONVERSATIONS_ENDPOINT: '/api/conversations',
  // Default request headers
  HEADERS: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
};

// UI State Messages for Dynamic Rendering
export const UI_MESSAGES = {
  LOADING_HISTORY: 'Loading history...',
  EMPTY_HISTORY: 'No conversations',
  ERROR_HISTORY: 'Unable to load conversation history.'
};
