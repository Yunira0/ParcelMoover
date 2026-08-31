import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { bannerImageUpload } from "../lib/bannerUpload";
import {
  listBannersController,
  getActiveBannersController,
  getBannerImageController,
  createBannerController,
  updateBannerController,
  deleteBannerController,
} from "../controllers/banner.controller";

const bannerRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const bannerReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("banner-read"),
  keyGenerator: actorOrIpKey,
});

const bannerWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("banner-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/banners/active — the live modal/permanent banner a vendor should
// see right now. Placed before /:id routes so "active" never gets swallowed
// as an id param.
bannerRouter.get(
  "/active",
  authMiddleware,
  authorizeRoles("vendor", "vendor_staff"),
  bannerReadLimiter,
  getActiveBannersController,
);

// GET /api/banners — full admin list, any status
bannerRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  bannerReadLimiter,
  listBannersController,
);

// POST /api/banners — create (multipart: image required)
bannerRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  bannerWriteLimiter,
  bannerImageUpload,
  createBannerController,
);

// GET /api/banners/:id/image — the creative itself. Open to vendor/vendor_staff
// too (unlike the admin-only /uploads mount), since they're the ones seeing it.
bannerRouter.get(
  "/:id/image",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  bannerReadLimiter,
  getBannerImageController,
);

// PATCH /api/banners/:id — update fields, optionally replacing the image
bannerRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  bannerWriteLimiter,
  bannerImageUpload,
  updateBannerController,
);

// DELETE /api/banners/:id
bannerRouter.delete(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  bannerWriteLimiter,
  deleteBannerController,
);

export default bannerRouter;
