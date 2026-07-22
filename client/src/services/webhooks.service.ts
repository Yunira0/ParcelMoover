import api from '../utils/api';

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  consecutive_failures: number;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatedWebhookEndpoint {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  created_at: string;
  /** Full plaintext signing secret — only ever present in the create/regenerate response. */
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  event_type: string;
  event_id: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempt_count: number;
  next_attempt_at: string;
  last_attempted_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
}

export interface DeliveryListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const getWebhookEndpoints = async (): Promise<WebhookEndpoint[]> => {
  const response = await api.get('/webhooks');
  return response.data.data;
};

export const createWebhookEndpoint = async (
  name: string,
  url: string,
): Promise<CreatedWebhookEndpoint> => {
  const response = await api.post('/webhooks', { name, url });
  return response.data.data;
};

export const updateWebhookEndpoint = async (
  id: string,
  patch: Partial<{ name: string; url: string; enabled: boolean }>,
): Promise<WebhookEndpoint> => {
  const response = await api.patch(`/webhooks/${id}`, patch);
  return response.data.data;
};

export const deleteWebhookEndpoint = async (id: string): Promise<void> => {
  await api.delete(`/webhooks/${id}`);
};

export const regenerateWebhookSecret = async (id: string): Promise<{ secret: string }> => {
  const response = await api.post(`/webhooks/${id}/regenerate-secret`);
  return response.data.data;
};

export const sendTestWebhookEvent = async (id: string): Promise<void> => {
  await api.post(`/webhooks/${id}/test`);
};

export const getWebhookDeliveries = async (
  id: string,
  page = 1,
): Promise<{ data: WebhookDelivery[]; meta: DeliveryListMeta }> => {
  const response = await api.get(`/webhooks/${id}/deliveries`, { params: { page } });
  return { data: response.data.data, meta: response.data.meta };
};

export const retryWebhookDelivery = async (id: string, deliveryId: string): Promise<void> => {
  await api.post(`/webhooks/${id}/deliveries/${deliveryId}/retry`);
};
