import api from '../utils/api';

export interface RegisterUserInput {
  type: 'admin' | 'vendor' | 'rider';
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  position?: string;
  clientName?: string;
  businessName?: string;
  locationId?: string;
  address?: string;
  joinedAt?: string;
}

export interface UpdateUserProfileInput {
  type: 'admin' | 'vendor' | 'rider';
  fullName?: string;
  phone?: string;
  position?: string;
  clientName?: string;
  businessName?: string;
  address?: string;
  joinedAt?: string;
}

export const registerUser = async (data: RegisterUserInput) => {
  const response = await api.post('/auth/users/register', data);
  return response.data;
};

export const getAdmins = async () => {
  const response = await api.get('/auth/users/admins'); 
  return response.data;
};

export const getVendors = async () => {
  const response = await api.get('/auth/users/vendors');
  return response.data;
};

export const getRiders = async () => {
  const response = await api.get('/auth/users/riders');
  return response.data;
};

export const getLocations = async () => {
  const response = await api.get('/auth/locations');
  return response.data;
};

export const updateUserProfile = async (id: string, data: UpdateUserProfileInput) => {
  const response = await api.patch(`/auth/users/${data.type}/${id}`, data);
  return response.data;
};

export const updateUserPassword = async (
  type: UpdateUserProfileInput['type'],
  id: string,
  password: string,
) => {
  const response = await api.patch(`/auth/users/${type}/${id}/password`, { password });
  return response.data;
};
