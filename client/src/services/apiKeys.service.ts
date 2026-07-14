import api from '../utils/api';

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  /** Full plaintext key — only ever present in the create response. */
  key: string;
}

export const getApiKeys = async (): Promise<ApiKey[]> => {
  const response = await api.get('/api-keys');
  return response.data.data;
};

export const createApiKey = async (name: string): Promise<CreatedApiKey> => {
  const response = await api.post('/api-keys', { name });
  return response.data.data;
};

export const revokeApiKey = async (id: string): Promise<void> => {
  await api.delete(`/api-keys/${id}`);
};
