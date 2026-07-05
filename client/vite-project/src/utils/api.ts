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

// The backend now enforces a pending forced password change on every
// authenticated call (not just at login), so a session whose cached
// `user.mustChangePassword` is stale (e.g. the flag flipped true after this
// browser's login/cache was set) would otherwise 403 on every request with no
// explanation. Catch that specific response, resync the cache, and send the
// user to the same screen ProtectedRoute already redirects to on fresh logins.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.message;
    if (error.response?.status === 403 && message === 'Password change required before continuing') {
      try {
        const cached = JSON.parse(localStorage.getItem('user') || 'null');
        if (cached) {
          localStorage.setItem('user', JSON.stringify({ ...cached, mustChangePassword: true }));
        }
      } catch {
        // Malformed cache - nothing to resync, the redirect below still applies.
      }
      if (window.location.pathname !== '/change-password') {
        window.location.href = '/change-password';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
