import { Response } from "express";
import { createNotificationsSubscriber, NOTIFICATIONS_CHANNEL, NotificationEvent } from "./redisPubSub";

// Per-instance map of userId -> open SSE connections. Every instance subscribes
// to the same Redis channel and only writes to the local connections it holds,
// which is what makes this work correctly behind multiple Node processes/PM2 workers.
const connectionsByUser = new Map<string, Set<Response>>();
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;

  const subscriber = createNotificationsSubscriber();
  subscriber.subscribe(NOTIFICATIONS_CHANNEL).catch((error) => {
    console.error("[Redis] Failed to subscribe to notifications channel:", error);
    // Subscribe failed (e.g. Redis was briefly unreachable) - reset the flag so
    // the next SSE registration retries instead of real-time staying silently
    // dead for this process until it's restarted.
    subscribed = false;
    subscriber.disconnect();
  });

  subscriber.on("message", (_channel, message) => {
    let event: NotificationEvent;
    try {
      event = JSON.parse(message);
    } catch {
      return;
    }

    const connections = connectionsByUser.get(event.userId);
    if (!connections || connections.size === 0) return;

    const payload = `data: ${JSON.stringify(event.notification)}\n\n`;
    for (const res of connections) {
      res.write(payload);
    }
  });
}

export function registerSseConnection(userId: string, res: Response) {
  ensureSubscribed();
  let connections = connectionsByUser.get(userId);
  if (!connections) {
    connections = new Set();
    connectionsByUser.set(userId, connections);
  }
  connections.add(res);
}

export function unregisterSseConnection(userId: string, res: Response) {
  const connections = connectionsByUser.get(userId);
  if (!connections) return;
  connections.delete(res);
  if (connections.size === 0) {
    connectionsByUser.delete(userId);
  }
}
