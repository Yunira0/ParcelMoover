import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import {
  bulkUpdateOrderStatusController,
  createOrderController,
  dashboardSummaryController,
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

export default orderRouter;
