import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { apiKeyAuthMiddleware } from "../middlewares/apiKeyAuth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  publicCreateOrderSchema,
  publicListOrdersQuerySchema,
} from "../validators/publicApi.schema";
import {
  publicCreateOrderController,
  publicGetOrderController,
  publicListOrdersController,
} from "../controllers/publicApi.controller";

// Public partner API v1 — external e-commerce integrations authenticate with
// vendor API keys (header-only, no cookies → no CSRF middleware here).
const publicApiRouter: Router = Router();

const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("public-api-read"),
  keyGenerator: (req) => req.apiKey?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("public-api-write"),
  keyGenerator: (req) => req.apiKey?.id ?? ipKeyGenerator(req.ip ?? ""),
});

publicApiRouter.use(apiKeyAuthMiddleware);

// POST /api/v1/orders — place an order (requires UUID Idempotency-Key header).
publicApiRouter.post(
  "/orders",
  publicWriteLimiter,
  validate(publicCreateOrderSchema),
  publicCreateOrderController,
);

// GET /api/v1/orders — list own orders (paginated; ?status= comma-separated).
publicApiRouter.get(
  "/orders",
  publicReadLimiter,
  validate(publicListOrdersQuerySchema, "query"),
  publicListOrdersController,
);

// GET /api/v1/orders/:trackingId — track one of your own orders.
publicApiRouter.get("/orders/:trackingId", publicReadLimiter, publicGetOrderController);

// Express's default 404 responds with HTML; API clients should always get JSON.
publicApiRouter.use((_req, res) => {
  res.status(404).json({ success: false, message: "Not found" });
});

export default publicApiRouter;
