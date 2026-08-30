import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  listAnnouncementsController,
  getActiveAnnouncementsController,
  createAnnouncementController,
  updateAnnouncementController,
  deleteAnnouncementController,
} from "../controllers/announcement.controller";

const announcementRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const announcementReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("announcement-read"),
  keyGenerator: actorOrIpKey,
});

const announcementWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("announcement-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/announcements/active — every live announcement a vendor should see
// now. Placed before "/" so it never collides with an id-style route.
announcementRouter.get(
  "/active",
  authMiddleware,
  authorizeRoles("vendor", "vendor_staff"),
  announcementReadLimiter,
  getActiveAnnouncementsController,
);

// GET /api/announcements — full admin list, any status
announcementRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  announcementReadLimiter,
  listAnnouncementsController,
);

// POST /api/announcements — create
announcementRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  announcementWriteLimiter,
  createAnnouncementController,
);

// PATCH /api/announcements/:id — update
announcementRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  announcementWriteLimiter,
  updateAnnouncementController,
);

// DELETE /api/announcements/:id
announcementRouter.delete(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  announcementWriteLimiter,
  deleteAnnouncementController,
);

export default announcementRouter;
