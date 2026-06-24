import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import {
  bulkUpdateOrderStatusController,
  createOrderController,
  dashboardSummaryController,
  getOrderByTrackingIdController,
  listOrdersController,
  updateOrderStatusController,
} from "../controllers/order.controller";
import {
  createRemarkController,
  listRemarksController,
  replyToRemarkController,
} from "../controllers/remark.controller";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const orderRouter: Router = Router();

// absoulate route "i guess"
/*
POST   /orders
GET    /orders
GET    /orders/:id
GET    /orders/track/:trackingId
PATCH  /orders/:id
PATCH  /orders/:id/status
PATCH  /orders/:id/assign-rider
PATCH  /orders/bulk-status
GET    /orders/:id/remarks
POST   /orders/:id/remarks
POST   /orders/:id/remarks/:remarkId/replies
DELETE /orders/:id
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
  message: { success: false, message: "Too many remark attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("order-remarks"),
  keyGenerator: actorOrIpKey,
});

orderRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor"),
  createOrderLimiter,
  createOrderController,
);

orderRouter.get(
  "/dashboard-summary",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  dashboardSummaryController,
);

orderRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  listOrdersController,
);

// GET /orders/track/:trackingId - order detail by tracking ID
orderRouter.get(
  "/track/:trackingId",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  getOrderByTrackingIdController,
);

// PATCH /orders/:id/status
orderRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "rider"),
  statusUpdateLimiter,
  updateOrderStatusController,
);

// PATCH /orders/bulk-status - batch transitions used by OOV/dispatch operations
orderRouter.patch(
  "/bulk-status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "rider"),
  statusUpdateLimiter,
  bulkUpdateOrderStatusController,
);

// GET /orders/:id/remarks - threaded remarks for an order
orderRouter.get(
  "/:id/remarks",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  listRemarksController,
);

// POST /orders/:id/remarks - add a top-level remark
orderRouter.post(
  "/:id/remarks",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  remarkLimiter,
  createRemarkController,
);

// POST /orders/:id/remarks/:remarkId/replies - reply to a remark
orderRouter.post(
  "/:id/remarks/:remarkId/replies",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  remarkLimiter,
  replyToRemarkController,
);

export default orderRouter;
