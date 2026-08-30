import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getVendorVolumeSettingsController,
  updateVendorVolumeSettingsController,
} from "../controllers/vendorVolume.controller";

const vendorVolumeRouter: Router = Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("vendor-volume-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("vendor-volume-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// GET /api/vendor-volume/settings — the "High volume vendor" daily-parcel
// threshold (super admin only).
vendorVolumeRouter.get(
  "/settings",
  authMiddleware,
  authorizeRoles("super_admin"),
  readLimiter,
  getVendorVolumeSettingsController,
);

// PUT /api/vendor-volume/settings — update the threshold (super admin only).
vendorVolumeRouter.put(
  "/settings",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  updateVendorVolumeSettingsController,
);

export default vendorVolumeRouter;
