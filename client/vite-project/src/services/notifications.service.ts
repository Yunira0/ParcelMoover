import api from '../utils/api';

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  trackingId: string | null;
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

export const markNotificationRead = async (id: string): Promise<void> => {
  await api.patch(`/notifications/${id}/read`);
};

export const markAllNotificationsRead = async (): Promise<void> => {
  await api.patch('/notifications/read-all');
};

// EventSource only sends cookies cross-origin when withCredentials is set, which
// matches how the rest of the app authenticates (httpOnly accessToken cookie).
export const subscribeToNotificationStream = (
  onNotification: (notification: AppNotification) => void,
): (() => void) => {
  const baseURL = (import.meta.env.VITE_API_URL || '/api') as string;
  const source = new EventSource(`${baseURL}/notifications/stream`, { withCredentials: true });

  source.onmessage = (event) => {
    try {
      const notification = JSON.parse(event.data) as AppNotification;
      onNotification(notification);
    } catch {
      // heartbeat/comment lines have no `data:` payload and won't reach here
    }
  };

  return () => source.close();
};
