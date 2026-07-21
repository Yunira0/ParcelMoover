import api from '../utils/api';

export interface VendorNotice {
  id: string;
  /** Admin reference/alt text only - not shown to vendors. */
  title: string;
  imageUrl: string;
  isActive: boolean;
  isDismissable: boolean;
  target: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorNoticeWithDismissed extends VendorNotice {
  dismissed: boolean;
}

export interface VendorNoticeWithTargets extends VendorNotice {
  targetVendorIds: string[];
}

// --- Vendor-facing ---

export const getActiveVendorNotices = async (): Promise<{ success: boolean; data: VendorNoticeWithDismissed[] }> => {
  const response = await api.get('/vendor-notices/active');
  return response.data;
};

export const dismissVendorNotice = async (id: string): Promise<{ success: boolean }> => {
  const response = await api.post(`/vendor-notices/${id}/dismiss`);
  return response.data;
};

// --- Admin-facing ---

export const listVendorNotices = async (): Promise<{ success: boolean; data: VendorNotice[] }> => {
  const response = await api.get('/vendor-notices');
  return response.data;
};

export const getVendorNoticeById = async (id: string): Promise<{ success: boolean; data: VendorNoticeWithTargets }> => {
  const response = await api.get(`/vendor-notices/${id}`);
  return response.data;
};

export const createVendorNotice = async (data: {
  title: string;
  imageUrl: string;
  isDismissable?: boolean;
  target?: string;
  targetVendorIds?: string[];
}): Promise<{ success: boolean; data: VendorNotice }> => {
  const response = await api.post('/vendor-notices', data);
  return response.data;
};

export const updateVendorNotice = async (id: string, data: {
  title?: string;
  imageUrl?: string;
  isActive?: boolean;
  isDismissable?: boolean;
  target?: string;
  targetVendorIds?: string[];
}): Promise<{ success: boolean; data: VendorNotice }> => {
  const response = await api.put(`/vendor-notices/${id}`, data);
  return response.data;
};

export const deleteVendorNotice = async (id: string): Promise<{ success: boolean }> => {
  const response = await api.delete(`/vendor-notices/${id}`);
  return response.data;
};

export const hardDeleteVendorNotice = async (id: string): Promise<{ success: boolean }> => {
  const response = await api.post(`/vendor-notices/${id}/hard-delete`);
  return response.data;
};

export const uploadNoticeImage = async (file: File): Promise<{ success: boolean; data: { imageUrl: string } }> => {
  const formData = new FormData();
  formData.append('image', file);
  const response = await api.post('/vendor-notices/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};
