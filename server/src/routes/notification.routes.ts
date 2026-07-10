import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { uuidParamSchema, paginationQuerySchema } from "../validators/common";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getUnreadCountByTypeController,
  getUnreadCountController,
  listNotificationsController,
  markAllNotificationsReadController,
  markNotificationReadController,
  markNotificationsReadByTrackingIdController,
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
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("notifications-read"),
  keyGenerator: actorOrIpKey,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("notifications-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/notifications/stream — SSE, long-lived connection; deliberately not rate-limited
notificationRouter.get("/stream", authMiddleware, streamNotificationsController);

// GET /api/notifications/unread-count — cheap polling fallback / badge refresh
notificationRouter.get("/unread-count", authMiddleware, readLimiter, getUnreadCountController);

// GET /api/notifications/unread-count-by-type — per-module badge counts
notificationRouter.get("/unread-count-by-type", authMiddleware, readLimiter, getUnreadCountByTypeController);

// GET /api/notifications — paginated notification feed
notificationRouter.get(
  "/",
  authMiddleware,
  readLimiter,
  validate(paginationQuerySchema, "query"),
  listNotificationsController,
);

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
  validate(uuidParamSchema, "params"),
  markNotificationReadController,
);

// PATCH /api/notifications/by-tracking/:trackingId/read — marks every unread
// notification for one entity (e.g. all notifications for a ticket id) read
// at once, used when the user opens the related record directly.
notificationRouter.patch(
  "/by-tracking/:trackingId/read",
  authMiddleware,
  csrfProtection,
  writeLimiter,
  markNotificationsReadByTrackingIdController,
);

export default notificationRouter;
