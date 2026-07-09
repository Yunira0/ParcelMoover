import { Response } from "express";
import { createNotificationsSubscriber, NOTIFICATIONS_CHANNEL, NotificationEvent } from "./redisPubSub";

// Per-instance map of userId -> open SSE connections. Every instance subscribes
// to the same Redis channel and only writes to the local connections it holds,
// which is what makes this work correctly behind multiple Node processes/PM2 workers.
const connectionsByUser = new Map<string, Set<Response>>();

// Caps how many concurrent streams one user can hold open, so a runaway client
// (tab-spam, retry loop with no backoff) can't exhaust server memory/FDs.
const MAX_CONNECTIONS_PER_USER = 5;

let subscriberStarted = false;

function ensureSubscribed() {
  if (subscriberStarted) return;
  subscriberStarted = true;

  const subscriber = createNotificationsSubscriber();

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
      try {
        res.write(payload);
      } catch (error) {
        console.error("[SSE] Failed to write to a connection, dropping it:", error);
        connections.delete(res);
      }
    }
    if (connections.size === 0) {
      connectionsByUser.delete(event.userId);
    }
  });

  const doSubscribe = () => {
    subscriber.subscribe(NOTIFICATIONS_CHANNEL).catch((error) => {
      console.error("[Redis] Failed to subscribe to notifications channel:", error);
    });
  };

  // ioredis drops subscriptions on disconnect and re-emits "ready" on every
  // reconnect, so a persistent listener (not .once) is what keeps this
  // resubscribed across Redis blips - and it reuses the same connection
  // instead of ever creating another one, so no connection ever leaks.
  subscriber.on("ready", doSubscribe);
  if (subscriber.status === "ready") {
    doSubscribe();
  }
}

export function registerSseConnection(userId: string, res: Response): boolean {
  ensureSubscribed();
  let connections = connectionsByUser.get(userId);
  if (!connections) {
    connections = new Set();
    connectionsByUser.set(userId, connections);
  }
  if (connections.size >= MAX_CONNECTIONS_PER_USER) {
    return false;
  }
  connections.add(res);
  return true;
}

export function unregisterSseConnection(userId: string, res: Response) {
  const connections = connectionsByUser.get(userId);
  if (!connections) return;
  connections.delete(res);
  if (connections.size === 0) {
    connectionsByUser.delete(userId);
  }
}
