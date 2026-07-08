import axios from 'axios';

// Helper to get cookie value by name
function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  // Without this, axios waits forever by default - a stuck backend request
  // (e.g. a rate-limit check hanging on an unreachable Redis) would leave the
  // UI spinning indefinitely with no error ever surfacing.
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to attach CSRF token from cookie to request headers
api.interceptors.request.use(
  (config) => {
    const csrfToken = getCookie('csrfToken');
    if (csrfToken && config.headers) {
      config.headers['x-csrf-token'] = csrfToken;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Guard so concurrent 401s (e.g. a dashboard firing several requests at once)
// only trigger a single cleanup + redirect.
let isHandlingSessionExpiry = false;

// Response interceptor: when the session is no longer valid (401), clear the
// local session and send the user to the login screen instead of leaving them
// stuck on a confusing error state.
//
// NOTE: we intentionally do NOT treat 403 as a session-expiry. In this app 403
// is returned for legitimate authorization denials (CSRF, role checks,
// must-change-password) where logging the user out would be wrong.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const requestUrl: string = error.config?.url ?? '';

    // A 401 on the login request means "wrong credentials" — let the Login page
    // display that; don't redirect (there's nothing to log out of).
    const isLoginRequest = requestUrl.includes('/auth/login');

    if (status === 401 && !isLoginRequest && !isHandlingSessionExpiry) {
      isHandlingSessionExpiry = true;
      localStorage.removeItem('user');

      if (window.location.pathname !== '/login') {
        // Full-page redirect: this interceptor lives outside React Router, so we
        // can't use navigate() here.
        window.location.assign('/login?expired=1');
      }
    }

    return Promise.reject(error);
  }
);

export default api;
