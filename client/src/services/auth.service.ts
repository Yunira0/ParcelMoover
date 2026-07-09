import api from '../utils/api';
import type { LoginCredentials } from '../types/auth';

export const login = async (credentials: LoginCredentials)=> {
  const response = await api.post('/auth/login', credentials);
  return response.data;
};

export const logout = async () => {
  const response = await api.post('/auth/logout');
  return response.data;
};

export const getCurrentUser = async () => {
  const response = await api.get('/me');
  return response.data;
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  const response = await api.post('/auth/change-password', { currentPassword, newPassword });
  return response.data;
};

export const updateMe = async (data: { fullName: string; phone?: string }) => {
  const response = await api.patch('/me', data);
  return response.data;
};
