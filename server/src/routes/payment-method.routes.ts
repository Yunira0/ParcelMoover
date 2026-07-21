import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
} from "../validators/payment-method.schema";
import {
  listPaymentMethodsController,
  createPaymentMethodController,
  updatePaymentMethodController,
} from "../controllers/payment-method.controller";

const paymentMethodRouter: Router = Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("payment-method-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("payment-method-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// GET /api/payment-methods — list methods for the settlement payment flow.
// Admins get the active set; super admins may request all (?activeOnly=false).
paymentMethodRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  readLimiter,
  listPaymentMethodsController,
);

// POST /api/payment-methods — add a new method (super admin only).
paymentMethodRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  validate(createPaymentMethodSchema),
  createPaymentMethodController,
);

// PATCH /api/payment-methods/:id — enable/disable a method (super admin only).
paymentMethodRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  validate(updatePaymentMethodSchema),
  updatePaymentMethodController,
);

export default paymentMethodRouter;
