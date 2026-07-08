import { Request, Response } from "express";
import {
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
} from "../services/notification.service";
import { registerSseConnection, unregisterSseConnection } from "../lib/sseHub";

export async function listNotificationsController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    let page: number | undefined;
    let pageSize: number | undefined;
    if (req.query.page !== undefined) {
      page = Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) {
        return res.status(400).json({ success: false, message: "page must be a positive integer" });
      }
    }
    if (req.query.pageSize !== undefined) {
      pageSize = Number(req.query.pageSize);
      if (!Number.isInteger(pageSize) || pageSize < 1) {
        return res.status(400).json({ success: false, message: "pageSize must be a positive integer" });
      }
    }

    const result = await listNotifications(req.user.id, page, pageSize);
    return res.status(200).json({ success: true, data: result.data, meta: result.meta });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load notifications",
    });
  }
}

export async function getUnreadCountController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const count = await getUnreadCount(req.user.id);
    return res.status(200).json({ success: true, data: { count } });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load unread notification count",
    });
  }
}

export async function markNotificationReadController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { id } = req.params;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ success: false, message: "Invalid notification id" });
    }
    await markAsRead(req.user.id, id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to mark notification as read",
    });
  }
}

export async function markAllNotificationsReadController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    await markAllAsRead(req.user.id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to mark notifications as read",
    });
  }
}

// SSE stream - kept outside the JSON response cycle, so it doesn't go through
// the usual try/catch-and-respond-once pattern used by the other controllers.
export function streamNotificationsController(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  if (!registerSseConnection(userId, res)) {
    res.status(429).json({ success: false, message: "Too many open notification streams" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(": connected\n\n");

  // Keeps intermediary proxies/load balancers from timing out the idle connection.
  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unregisterSseConnection(userId, res);
  });
}
