import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { uuidParamSchema } from "../validators/common";
import {
  createOrderSchema,
  updateOrderDetailsSchema,
  updateOrderStatusSchema,
  bulkUpdateOrderStatusSchema,
  listOrdersQuerySchema,
  orderFilterOptionsQuerySchema,
  orderCountByStatusQuerySchema,
  trashedOrdersQuerySchema,
  restoreOrderSchema,
  addOrderRemarkSchema,
  runSheetQuerySchema,
  redirectOrderSchema,
} from "../validators/order.schema";
import {
  addOrderRemarkController,
  bulkCreateOrdersController,
  bulkUpdateOrderStatusController,
  codSettlementDetailController,
  createOrderController,
  dashboardSummaryController,
  getOrderByTrackingIdController,
  getOrderFilterOptionsController,
  getOrderCountsByStatusController,
  listTrashedOrdersController,
  trashOrderController,
  restoreOrderController,
  deleteOrderPermanentlyController,
  getPublicOrderTrackingController,
  getSenderProfileController,
  getStatusCountsController,
  listOrdersController,
  redirectOrderController,
  riderRunSheetController,
  updateOrderDetailsController,
  updateOrderStatusController,
  merchantOverviewController,
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
  validate: false,
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
  validate: false,
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
  validate: false,
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
  validate: false,
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
  validate: false,
  store: createRedisRateLimitStore("order-read"),
  keyGenerator: actorOrIpKey,
});

// POST /orders/bulk — must be registered before POST /orders to avoid Express matching /bulk as a body param
orderRouter.post(
  "/bulk",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "sales", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  bulkCreateLimiter,
  bulkCreateOrdersController,
);

orderRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "sales", "vendor", "vendor_staff"),
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

// GET /orders/cod-settlement-detail — drill-down rows behind one line of the
// COD Settlement card. Same audience/scope as dashboard-summary.
orderRouter.get(
  "/cod-settlement-detail",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("DASHBOARD_ACCESS"),
  orderReadLimiter,
  codSettlementDetailController,
);

// GET /orders/status-counts — lightweight per-status-group counts for operation
// page tab badges. Accepts a JSON-encoded groups map as a query param.
orderRouter.get(
  "/status-counts",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  getStatusCountsController,
);

// POST /orders/status-counts — same read, same controller, body instead of
// query string. Used once a scan batch's `search` term list is too long to
// fit safely in a URL (see MAX_SCANNED_TERMS in the client). Read-only, so
// no csrfProtection - matches the GET route's exemption.
orderRouter.post(
  "/status-counts",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  getStatusCountsController,
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

// GET /orders/filter-options — lean, tab-scoped values for the orders list
// page's origin/rider/destination dropdowns (must come before "/").
orderRouter.get(
  "/filter-options",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  validate(orderFilterOptionsQuerySchema, "query"),
  getOrderFilterOptionsController,
);

// GET /orders/count-by-status — per-status totals for the list page's tab badges
// (must come before "/" for the same reason as /filter-options above).
orderRouter.get(
  "/count-by-status",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  validate(orderCountByStatusQuerySchema, "query"),
  getOrderCountsByStatusController,
);

// ── Trash ────────────────────────────────────────────────────────────────────
// Admin-only: a vendor/sales/rider actor can't reach the trash at all, so the
// soft-deleted rows they'd otherwise never see stay invisible to them.
// "/trash" must be registered before "/" and before "/:id" so neither swallows it.
orderRouter.get(
  "/trash",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  validate(trashedOrdersQuerySchema, "query"),
  listTrashedOrdersController,
);

// GET /orders/merchant-overview — server-side aggregated stats for the Merchant
// Overview page. Scoped the same way as dashboard-summary.
orderRouter.get(
  "/merchant-overview",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("DASHBOARD_ACCESS"),
  orderReadLimiter,
  merchantOverviewController,
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

// POST /orders/search — identical filters, same controller, body instead of
// query string. Used once a scan batch's `search` term list is too long to
// fit safely in a URL (see MAX_SCANNED_TERMS in the client). Read-only, so
// no csrfProtection - matches GET /orders' exemption.
orderRouter.post(
  "/search",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  orderReadLimiter,
  validate(listOrdersQuerySchema, "body"),
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
  validate: false,
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

// PATCH /orders/:id — edit parcel details (receiver, route, weight, COD, …).
// Status changes stay on /:id/status; this route never moves a parcel.
orderRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  validate(uuidParamSchema, "params"),
  validate(updateOrderDetailsSchema),
  updateOrderDetailsController,
);

// POST /orders/:id/redirect — customer moved: point the parcel at a different
// destination branch/address, with a reason and a diversion charge. Admin-only;
// vendors go through support so the fee is always an ops decision.
orderRouter.post(
  "/:id/redirect",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  validate(uuidParamSchema, "params"),
  validate(redirectOrderSchema),
  redirectOrderController,
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

// POST /orders/:id/trash — soft-delete: drops the order out of every list and
// into the trash. Admin-only, like the rest of the trash surface.
orderRouter.post(
  "/:id/trash",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  validate(uuidParamSchema, "params"),
  trashOrderController,
);

// POST /orders/:id/restore — undo a trashing, manual or automatic.
orderRouter.post(
  "/:id/restore",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  validate(uuidParamSchema, "params"),
  validate(restoreOrderSchema),
  restoreOrderController,
);

// DELETE /orders/:id/permanent — unrecoverable, and refused outright for any
// order carrying accounting or COD records. The client confirms before calling.
orderRouter.delete(
  "/:id/permanent",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  validate(uuidParamSchema, "params"),
  deleteOrderPermanentlyController,
);

export default orderRouter;
