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
  // Same one-shot suppression as the main client in redis.ts - without Redis
  // running, the retry loop would otherwise log this every ~2s forever.
  let errorLogged = false;
  subscriber.on("error", (error) => {
    if (!errorLogged) {
      console.error("[Redis] Notifications subscriber error (further errors suppressed):", error.message);
      errorLogged = true;
    }
  });
  subscriber.on("connect", () => { errorLogged = false; });
  return subscriber;
}
