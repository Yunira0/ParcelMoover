import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  getDeliveryQuoteController,
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
  store: createRedisRateLimitStore("delivery-rate-quote"),
  keyGenerator: actorOrIpKey,
});

const ratesReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("delivery-rate-read"),
  keyGenerator: actorOrIpKey,
});

const ratesWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { success: false, message: "Too many rate changes, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("delivery-rate-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/delivery-rates/quote — used by the order form to auto-calculate the payable amount
deliveryRateRouter.get(
  "/quote",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor"),
  quoteLimiter,
  getDeliveryQuoteController,
);

// GET /api/delivery-rates — list all configured routes
// Vendors get read-only access so they can see the charges that apply to them.
deliveryRateRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor"),
  ratesReadLimiter,
  listDeliveryRatesController,
);

// POST /api/delivery-rates — create/update the rate for a route
deliveryRateRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  ratesWriteLimiter,
  upsertDeliveryRateController,
);

// PATCH /api/delivery-rates/:id/active — enable/disable a route's rate
deliveryRateRouter.patch(
  "/:id/active",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  ratesWriteLimiter,
  setDeliveryRateActiveController,
);

export default deliveryRateRouter;
