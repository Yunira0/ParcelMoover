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

export default api;
