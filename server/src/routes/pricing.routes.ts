import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getPricingSettingsController,
  updatePricingSettingsController,
  getVendorQuoteController,
} from "../controllers/pricing.controller";

const pricingRouter: Router = Router();

const pricingReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("pricing-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const pricingWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("pricing-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Quote is called on essentially every order-create form keystroke, so it
// gets its own, more generous limiter rather than sharing the settings-read one.
const quoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("pricing-quote"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// GET /api/pricing/settings — zone + flat (valley) rate config. Readable by
// everyone who can create a vendor, so the form can prefill the default rates.
pricingRouter.get(
  "/settings",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "sales"),
  pricingReadLimiter,
  getPricingSettingsController,
);

// PUT /api/pricing/settings — update zone/flat rates (super admin only)
pricingRouter.put(
  "/settings",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  pricingWriteLimiter,
  updatePricingSettingsController,
);

// GET /api/pricing/quote — vendor-aware delivery charge for a destination.
// Part of the order-creation flow, so gated by ORDER_ACCESS (not a finance/rate permission).
pricingRouter.get(
  "/quote",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  quoteLimiter,
  getVendorQuoteController,
);

export default pricingRouter;
