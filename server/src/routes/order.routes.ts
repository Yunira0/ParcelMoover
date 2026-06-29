import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { validate } from "../middlewares/validate.middleware";
import { uuidParamSchema } from "../validators/common";
import {
  createOrderSchema,
  updateOrderStatusSchema,
  bulkUpdateOrderStatusSchema,
  listOrdersQuerySchema,
  addOrderRemarkSchema,
} from "../validators/order.schema";
import {
  addOrderRemarkController,
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
GET    /orders
GET    /orders/:id
GET    /orders/track/:trackingId
PATCH  /orders/:id
PATCH  /orders/:id/status
PATCH  /orders/:id/assign-rider
PATCH  /orders/bulk-status
POST   /orders/:id/remarks
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
  message: { success: false, message: "Too many remarks added" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("order-remark"),
  keyGenerator: actorOrIpKey,
});

orderRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor"),
  createOrderLimiter,
  validate(createOrderSchema),
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
  validate(listOrdersQuerySchema, "query"),
  listOrdersController,
);

// GET /orders/track/:trackingId — single order detail (must come before any /:id route)
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
  validate(uuidParamSchema, "params"),
  validate(updateOrderStatusSchema),
  updateOrderStatusController,
);

// POST /orders/:id/remarks - leave a remark on a parcel (visible to anyone with access to it)
orderRouter.post(
  "/:id/remarks",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  remarkLimiter,
  validate(uuidParamSchema, "params"),
  validate(addOrderRemarkSchema),
  addOrderRemarkController,
);

// PATCH /orders/bulk-status - batch transitions used by OOV/dispatch operations
orderRouter.patch(
  "/bulk-status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "rider"),
  statusUpdateLimiter,
  validate(bulkUpdateOrderStatusSchema),
  bulkUpdateOrderStatusController,
);

export default orderRouter;
