import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getUnreadCountController,
  listNotificationsController,
  markAllNotificationsReadController,
  markNotificationReadController,
  streamNotificationsController,
} from "../controllers/notification.controller";

const notificationRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("notifications-read"),
  keyGenerator: actorOrIpKey,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("notifications-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/notifications/stream — SSE, long-lived connection; deliberately not rate-limited
notificationRouter.get("/stream", authMiddleware, streamNotificationsController);

// GET /api/notifications/unread-count — cheap polling fallback / badge refresh
notificationRouter.get("/unread-count", authMiddleware, readLimiter, getUnreadCountController);

// GET /api/notifications — paginated notification feed
notificationRouter.get("/", authMiddleware, readLimiter, listNotificationsController);

// PATCH /api/notifications/read-all
notificationRouter.patch(
  "/read-all",
  authMiddleware,
  csrfProtection,
  writeLimiter,
  markAllNotificationsReadController,
);

// PATCH /api/notifications/:id/read
notificationRouter.patch(
  "/:id/read",
  authMiddleware,
  csrfProtection,
  writeLimiter,
  markNotificationReadController,
);

export default notificationRouter;
