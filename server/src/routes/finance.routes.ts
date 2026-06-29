import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  pendingCodQuerySchema,
  orderCodQuerySchema,
  settlementsQuerySchema,
} from "../validators/finance.schema";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getPendingCodController,
  listOrderCodController,
  listSettlementsController,
} from "../controllers/finance.controller";

const financeRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const financeReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("finance-read"),
  keyGenerator: actorOrIpKey,
});

// GET /api/finance/pending-cod — vendor's pending COD billing statement
financeRouter.get(
  "/pending-cod",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor"),
  financeReadLimiter,
  validate(pendingCodQuerySchema, "query"),
  getPendingCodController,
);

// GET /api/finance/order-cod — per-order COD payment status, settled vs not settled
financeRouter.get(
  "/order-cod",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor"),
  financeReadLimiter,
  validate(orderCodQuerySchema, "query"),
  listOrderCodController,
);

// GET /api/finance/settlements — historical settlement statements
financeRouter.get(
  "/settlements",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor"),
  financeReadLimiter,
  validate(settlementsQuerySchema, "query"),
  listSettlementsController,
);

export default financeRouter;
