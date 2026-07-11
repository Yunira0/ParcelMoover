import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { uuidParamSchema } from "../validators/common";
import {
  createOrderSchema,
  updateOrderStatusSchema,
  bulkUpdateOrderStatusSchema,
  listOrdersQuerySchema,
  addOrderRemarkSchema,
  runSheetQuerySchema,
} from "../validators/order.schema";
import {
  addOrderRemarkController,
  bulkCreateOrdersController,
  bulkUpdateOrderStatusController,
  createOrderController,
  dashboardSummaryController,
  getOrderByTrackingIdController,
  getPublicOrderTrackingController,
  getSenderProfileController,
  listOrdersController,
  riderRunSheetController,
  updateOrderStatusController,
} from "../controllers/order.controller";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const orderRouter: Router = Router();

// absoulate route "i guess"
/*
POST   /orders
POST   /orders/bulk
GET    /orders
GET    /orders/track/:trackingId
GET    /orders/public-track/:trackingId   (unauthenticated)
PATCH  /orders/:id/status
PATCH  /orders/bulk-status
POST   /orders/:id/remarks
 */

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 orders per minute per IP
  message: { success: false, message: "Too many order creation attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("create-order"),
  keyGenerator: actorOrIpKey,
});

const statusUpdateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { success: false, message: "Too many status update attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("order-status"),
  keyGenerator: actorOrIpKey,
});

const remarkLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { success: false, message: "Too many remarks added" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("order-remark"),
  keyGenerator: actorOrIpKey,
});

// One slot = one batch (up to 100 orders), so vendors can't spam by batching.
const bulkCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many bulk order requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("bulk-create-order"),
  keyGenerator: actorOrIpKey,
});

// Covers list/dashboard/track — the heaviest GET endpoints in the app
// (dashboard-summary alone fans out into ~17 aggregate queries on a cache
// miss), which previously had no rate limiting at all despite every write
// endpoint in this file being protected.
const orderReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("order-read"),
  keyGenerator: actorOrIpKey,
});

// POST /orders/bulk — must be registered before POST /orders to avoid Express matching /bulk as a body param
orderRouter.post(
  "/bulk",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  bulkCreateLimiter,
  bulkCreateOrdersController,
);

orderRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  createOrderLimiter,
  validate(createOrderSchema),
  createOrderController,
);

orderRouter.get(
  "/dashboard-summary",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("DASHBOARD_ACCESS"),
  orderReadLimiter,
  dashboardSummaryController,
);

// GET /orders/sender-profile — the calling vendor/vendor_staff's own business identity,
// used to auto-fill "sender" on order creation instead of asking them to type it in.
orderRouter.get(
  "/sender-profile",
  authMiddleware,
  authorizeRoles("vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  getSenderProfileController,
);

// GET /orders/run-sheet — parcels currently out for delivery (sent_for_delivery),
// grouped by the rider carrying them. Admin-side only.
orderRouter.get(
  "/run-sheet",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  orderReadLimiter,
  validate(runSheetQuerySchema, "query"),
  riderRunSheetController,
);

orderRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  validate(listOrdersQuerySchema, "query"),
  listOrdersController,
);

// GET /orders/public-track/:trackingId — unauthenticated lookup for the public
// landing-page tracker. Separate, tighter limiter than orderReadLimiter since
// this route has no auth to fall back on for abuse control - just IP + a
// pre-DB format/check-digit check in the controller.
const publicTrackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many tracking requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("public-track"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

orderRouter.get(
  "/public-track/:trackingId",
  publicTrackLimiter,
  getPublicOrderTrackingController,
);

// GET /orders/track/:trackingId — single order detail (must come before any /:id route)
orderRouter.get(
  "/track/:trackingId",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  getOrderByTrackingIdController,
);

// PATCH /orders/bulk-status — must be before /:id/status to avoid Express 5 parametric shadowing
orderRouter.patch(
  "/bulk-status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "rider", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  validate(bulkUpdateOrderStatusSchema),
  bulkUpdateOrderStatusController,
);

// PATCH /orders/:id/status
orderRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "rider", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  validate(uuidParamSchema, "params"),
  validate(updateOrderStatusSchema),
  updateOrderStatusController,
);

// POST /orders/:id/remarks - leave a remark on a parcel (visible to anyone with access to it)
orderRouter.post(
  "/:id/remarks",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  remarkLimiter,
  validate(uuidParamSchema, "params"),
  validate(addOrderRemarkSchema),
  addOrderRemarkController,
);

export default orderRouter;
