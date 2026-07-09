import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  createStaffController,
  getMyStaffProfileController,
  listStaffController,
  setStaffEnabledController,
  updateStaffController,
} from "../controllers/staff.controller";

const staffRouter: Router = Router();

const staffReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("staff-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const staffWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("staff-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Staff member fetches their own live permissions (called on app mount to avoid stale localStorage).
staffRouter.get("/me", authMiddleware, authorizeRoles("vendor_staff"), staffReadLimiter, getMyStaffProfileController);

// All other staff endpoints are vendor-owned.
staffRouter.get("/", authMiddleware, authorizeRoles("vendor"), staffReadLimiter, listStaffController);

staffRouter.post("/", authMiddleware, csrfProtection, authorizeRoles("vendor"), staffWriteLimiter, createStaffController);

staffRouter.patch("/:id", authMiddleware, csrfProtection, authorizeRoles("vendor"), staffWriteLimiter, updateStaffController);

staffRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("vendor"),
  staffWriteLimiter,
  setStaffEnabledController,
);

export default staffRouter;
