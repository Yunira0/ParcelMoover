import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import {
  addOrderRemarkController,
  bulkCreateOrdersController,
  bulkUpdateOrderStatusController,
  createOrderController,
  dashboardSummaryController,
  getOrderByTrackingIdController,
  listOrdersController,
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
PATCH  /orders/:id/status
PATCH  /orders/bulk-status
POST   /orders/:id/remarks
 */

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, //. 100 orders per minute per IP
  message: { success: false, message: "Too many order creation attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("create-order"),
  keyGenerator: actorOrIpKey,
});

const statusUpdateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { success: false, message: "Too many status update attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("order-status"),
  keyGenerator: actorOrIpKey,
});

const remarkLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { success: false, message: "Too many remarks added" },
  standardHeaders: true,
  legacyHeaders: false,
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
  store: createRedisRateLimitStore("bulk-create-order"),
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
  createOrderController,
);

orderRouter.get(
  "/dashboard-summary",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("DASHBOARD_ACCESS"),
  dashboardSummaryController,
);

orderRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  listOrdersController,
);

// GET /orders/track/:trackingId — single order detail (must come before any /:id route)
orderRouter.get(
  "/track/:trackingId",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("ORDER_ACCESS"),
  getOrderByTrackingIdController,
);

// PATCH /orders/:id/status
orderRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "rider", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
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
  addOrderRemarkController,
);

// PATCH /orders/bulk-status — batch transitions; vendors allowed (service enforces valid transitions)
orderRouter.patch(
  "/bulk-status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "rider", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  statusUpdateLimiter,
  bulkUpdateOrderStatusController,
);

export default orderRouter;
