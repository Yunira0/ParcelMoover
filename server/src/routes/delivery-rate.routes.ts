import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { uuidParamSchema } from "../validators/common";
import {
  upsertDeliveryRateSchema,
  deliveryQuoteQuerySchema,
  setDeliveryRateActiveSchema,
  bulkImportDeliveryRatesSchema,
} from "../validators/delivery-rate.schema";
import {
  bulkImportDeliveryRatesController,
  getDeliveryQuoteController,
  getMyDeliveryRatesController,
  listDeliveryRatesController,
  setDeliveryRateActiveController,
  upsertDeliveryRateController,
} from "../controllers/delivery-rate.controller";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const deliveryRateRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

// Generous since the order form calls this on every weight/route change to recalc price.
const quoteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { success: false, message: "Too many quote requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("delivery-rate-quote"),
  keyGenerator: actorOrIpKey,
});

const ratesReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("delivery-rate-read"),
  keyGenerator: actorOrIpKey,
});

const ratesWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { success: false, message: "Too many rate changes, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("delivery-rate-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/delivery-rates/quote — used by the order form to auto-calculate the payable amount.
// Gated by ORDER_ACCESS (not DELIVERY_CHARGES_ACCESS) since it's part of the order-creation flow.
deliveryRateRouter.get(
  "/quote",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  quoteLimiter,
  validate(deliveryQuoteQuerySchema, "query"),
  getDeliveryQuoteController,
);

// GET /api/delivery-rates/my-rates — the rates that actually apply to the
// requesting vendor, computed from their own rate model (flat / zone /
// per-destination), one row per destination.
deliveryRateRouter.get(
  "/my-rates",
  authMiddleware,
  authorizeRoles("vendor", "vendor_staff"),
  requireStaffPermission("DELIVERY_CHARGES_ACCESS"),
  ratesReadLimiter,
  getMyDeliveryRatesController,
);

// GET /api/delivery-rates — list all configured routes
// Vendors get read-only access so they can see the charges that apply to them.
// Note: the /quote endpoint above is deliberately NOT gated by
// DELIVERY_CHARGES_ACCESS - it's also used by the order creation form to
// auto-price a shipment, which only requires ORDER_ACCESS.
deliveryRateRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("DELIVERY_CHARGES_ACCESS"),
  ratesReadLimiter,
  listDeliveryRatesController,
);

// POST /api/delivery-rates — create/update the rate for a route
deliveryRateRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  ratesWriteLimiter,
  validate(upsertDeliveryRateSchema),
  upsertDeliveryRateController,
);

// Bulk import handles a whole spreadsheet at once, so it gets a tighter cap
// than ordinary single-row writes.
const ratesBulkImportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("delivery-rate-bulk-import"),
  keyGenerator: actorOrIpKey,
});

// POST /api/delivery-rates/bulk-import — upsert route rates from an Excel/CSV upload
deliveryRateRouter.post(
  "/bulk-import",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  ratesBulkImportLimiter,
  validate(bulkImportDeliveryRatesSchema),
  bulkImportDeliveryRatesController,
);

// PATCH /api/delivery-rates/:id/active — enable/disable a route's rate
deliveryRateRouter.patch(
  "/:id/active",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  ratesWriteLimiter,
  validate(uuidParamSchema, "params"),
  validate(setDeliveryRateActiveSchema),
  setDeliveryRateActiveController,
);

export default deliveryRateRouter;
