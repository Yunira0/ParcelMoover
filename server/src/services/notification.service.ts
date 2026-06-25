import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { AppError } from "../utils/AppError";
import { publishNotification } from "../lib/redisPubSub";

const UNREAD_COUNT_PREFIX = "notifications:unread:";
const UNREAD_COUNT_TTL_SECONDS = 60;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

function unreadCountKey(userId: string) {
  return `${UNREAD_COUNT_PREFIX}${userId}`;
}

async function invalidateUnreadCount(userId: string) {
  try {
    await redis.del(unreadCountKey(userId));
  } catch (error) {
    console.error("[Redis] Failed to invalidate unread notification count:", error);
  }
}

export interface NotificationDTO {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

function mapNotification(notification: {
  id: string;
  title: string;
  body: string | null;
  read_at: Date | null;
  created_at: Date;
}): NotificationDTO {
  return {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    readAt: notification.read_at ? notification.read_at.toISOString() : null,
    createdAt: notification.created_at.toISOString(),
  };
}

// Best-effort: a notification is a side effect of some other action (a remark
// reply, a ticket assignment, a status change) and should never fail the
// action it's attached to just because Redis or the notification write hiccups.
export async function createNotification(
  userId: string,
  title: string,
  body?: string | null,
): Promise<void> {
  try {
    const notification = await prisma.notifications.create({
      data: { user_id: userId, title, body: body ?? null },
    });

    await invalidateUnreadCount(userId);
    await publishNotification({ userId, notification: mapNotification(notification) });
  } catch (error) {
    console.error("[Notifications] Failed to create notification:", error);
  }
}

export async function listNotifications(userId: string, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * take;

  const [total, notifications] = await Promise.all([
    prisma.notifications.count({ where: { user_id: userId } }),
    prisma.notifications.findMany({
      where: { user_id: userId },
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
  ]);

  return {
    data: notifications.map(mapNotification),
    meta: {
      page: safePage,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const cacheKey = unreadCountKey(userId);

  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return Number(cached);
    }
  } catch (error) {
    console.error("[Redis] Failed to read unread notification count:", error);
  }

  const count = await prisma.notifications.count({
    where: { user_id: userId, read_at: null },
  });

  try {
    await redis.setex(cacheKey, UNREAD_COUNT_TTL_SECONDS, String(count));
  } catch (error) {
    console.error("[Redis] Failed to cache unread notification count:", error);
  }

  return count;
}

export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  const notification = await prisma.notifications.findFirst({
    where: { id: notificationId, user_id: userId },
    select: { id: true, read_at: true },
  });

  if (!notification) {
    throw new AppError(404, "Notification not found");
  }

  if (notification.read_at) {
    return;
  }

  await prisma.notifications.update({
    where: { id: notificationId },
    data: { read_at: new Date() },
  });

  await invalidateUnreadCount(userId);
}

export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.notifications.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });

  await invalidateUnreadCount(userId);
}
