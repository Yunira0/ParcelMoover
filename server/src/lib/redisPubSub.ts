import redis from "./redis";

export const NOTIFICATIONS_CHANNEL = "notifications:events";

export interface NotificationPayload {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationEvent {
  userId: string;
  notification: NotificationPayload;
}

export async function publishNotification(event: NotificationEvent) {
  try {
    await redis.publish(NOTIFICATIONS_CHANNEL, JSON.stringify(event));
  } catch (error) {
    console.error("[Redis] Failed to publish notification event:", error);
  }
}

// A connection that issues SUBSCRIBE can no longer run normal commands, so the
// SSE hub needs its own connection instead of sharing the main `redis` client.
export function createNotificationsSubscriber() {
  const subscriber = redis.duplicate();
  subscriber.on("error", (error) => {
    console.error("[Redis] Notifications subscriber error:", error.message);
  });
  return subscriber;
}
