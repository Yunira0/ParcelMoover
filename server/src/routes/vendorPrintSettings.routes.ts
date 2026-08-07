import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { getLabelSizeController, updateLabelSizeController } from "../controllers/vendorPrintSettings.controller";

const vendorPrintSettingsRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("vendor-print-settings-read"),
  keyGenerator: actorOrIpKey,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many changes, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("vendor-print-settings-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/vendor-settings/label-size — gated on ORDER_ACCESS, not
// FINANCE_ACCESS: labels are printed from the Orders page, so a staff account
// that can print labels should also be able to fix a wrong-size one.
vendorPrintSettingsRouter.get(
  "/label-size",
  authMiddleware,
  authorizeRoles("vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  readLimiter,
  getLabelSizeController,
);

vendorPrintSettingsRouter.patch(
  "/label-size",
  authMiddleware,
  csrfProtection,
  authorizeRoles("vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  writeLimiter,
  updateLabelSizeController,
);

export default vendorPrintSettingsRouter;
