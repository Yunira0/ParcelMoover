import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getSlaSettingsController,
  updateSlaSettingsController,
} from "../controllers/sla.controller";

const slaRouter: Router = Router();

const slaReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("sla-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const slaWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("sla-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// GET /api/sla/settings — per-status SLA thresholds (super admin only).
slaRouter.get(
  "/settings",
  authMiddleware,
  authorizeRoles("super_admin"),
  slaReadLimiter,
  getSlaSettingsController,
);

// PUT /api/sla/settings — update per-status SLA thresholds (super admin only).
slaRouter.put(
  "/settings",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  slaWriteLimiter,
  updateSlaSettingsController,
);

export default slaRouter;
