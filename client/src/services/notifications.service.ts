import api from '../utils/api';

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  trackingId: string | null;
  type: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsListResponse {
  success: boolean;
  data: AppNotification[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const getNotifications = async (page = 1, pageSize = 20): Promise<NotificationsListResponse> => {
  const response = await api.get('/notifications', { params: { page, pageSize } });
  return response.data;
};

export const getUnreadNotificationCount = async (): Promise<number> => {
  const response = await api.get('/notifications/unread-count');
  return response.data.data.count;
};

export const getUnreadNotificationCountByType = async (): Promise<Record<string, number>> => {
  const response = await api.get('/notifications/unread-count-by-type');
  return response.data.data;
};

export const markNotificationRead = async (id: string): Promise<void> => {
  await api.patch(`/notifications/${id}/read`);
};

export const markAllNotificationsRead = async (): Promise<void> => {
  await api.patch('/notifications/read-all');
};

// Marks every unread notification tied to one entity (e.g. a ticket id) read
// at once - used when the user opens the related record directly, without
// ever clicking the notification itself.
export const markNotificationsReadByTrackingId = async (trackingId: string): Promise<void> => {
  await api.patch(`/notifications/by-tracking/${trackingId}/read`);
};

// EventSource only sends cookies cross-origin when withCredentials is set, which
// matches how the rest of the app authenticates (httpOnly accessToken cookie).
export const subscribeToNotificationStream = (
  onNotification: (notification: AppNotification) => void,
): (() => void) => {
  const baseURL = (import.meta.env.VITE_API_URL || '/api') as string;
  const url = `${baseURL}/notifications/stream`;

  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let closed = false;

  const connect = () => {
    if (closed) return;
    source = new EventSource(url, { withCredentials: true });

    // Stream is live again - reset the backoff so the next drop retries quickly.
    source.onopen = () => {
      attempts = 0;
    };

    source.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data) as AppNotification;
        onNotification(notification);
      } catch {
        // heartbeat/comment lines have no `data:` payload and won't reach here
      }
    };

    // Native EventSource retries on its own, but with a fixed interval and
    // forever (even after an auth failure). Take control: tear down and
    // reconnect with capped exponential backoff (1s → 30s).
    source.onerror = () => {
      source?.close();
      source = null;
      if (closed || reconnectTimer) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempts);
      attempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
  };
};
