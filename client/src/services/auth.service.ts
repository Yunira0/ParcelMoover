import api from '../utils/api';
import type { LoginCredentials } from '../types/auth';

export const login = async (credentials: LoginCredentials)=> {
  const response = await api.post('/auth/login', credentials);
  return response.data;
};

const SESSION_ENDED_EVENT = 'parcelmoover:session-ended';

// Fired on every logout, whether or not the server call succeeds - callers
// clear the local session either way, so anything cached for this user (the
// query cache) has to go with it before the next person signs in.
export const subscribeToSessionEnded = (handler: () => void) => {
  window.addEventListener(SESSION_ENDED_EVENT, handler);
  return () => window.removeEventListener(SESSION_ENDED_EVENT, handler);
};

export const logout = async () => {
  try {
    const response = await api.post('/auth/logout');
    return response.data;
  } finally {
    window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
  }
};

export const getCurrentUser = async () => {
  const response = await api.get('/me');
  return response.data;
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  const response = await api.post('/auth/change-password', { currentPassword, newPassword });
  return response.data;
};

export const updateMe = async (data: { fullName: string; phone?: string; hubId?: string | null }) => {
  const response = await api.patch('/me', data);
  return response.data;
};
