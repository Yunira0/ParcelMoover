import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { apiKeyAuthMiddleware } from "../middlewares/apiKeyAuth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  publicAddRemarkSchema,
  publicBulkStatusSchema,
  publicCancelOrderSchema,
  publicCreateOrderSchema,
  publicCreateTicketSchema,
  publicListOrdersQuerySchema,
  publicQuoteQuerySchema,
  publicTicketReplySchema,
} from "../validators/publicApi.schema";
import { listTicketsQuerySchema } from "../validators/ticket.schema";
import { buildOpenApiDocument } from "../lib/openapi";
import {
  publicBulkOrderStatusController,
  publicCancelOrderController,
  publicCreateOrderController,
  publicGetOrderController,
  publicListOrdersController,
} from "../controllers/publicApi/orders.controller";
import {
  publicGetRateQuoteController,
  publicGetRatesController,
} from "../controllers/publicApi/rates.controller";
import {
  publicAddRemarkController,
  publicListRemarksController,
} from "../controllers/publicApi/remarks.controller";
import {
  publicAddTicketReplyController,
  publicCreateTicketController,
  publicGetTicketController,
  publicListTicketsController,
} from "../controllers/publicApi/tickets.controller";

// Public partner API v1 — external e-commerce integrations authenticate with
// vendor API keys (header-only, no cookies → no CSRF middleware here).
const publicApiRouter: Router = Router();

const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    message: "Too many requests, please slow down",
    error: { code: "RATE_LIMITED" },
  },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("public-api-read"),
  keyGenerator: (req) => req.apiKey?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: "Too many requests, please slow down",
    error: { code: "RATE_LIMITED" },
  },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("public-api-write"),
  keyGenerator: (req) => req.apiKey?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Bulk lookups are read-only in effect but ~100x the DB cost of one read, so
// they get their own tier instead of sharing the read or write budget.
const publicBulkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Too many requests, please slow down",
    error: { code: "RATE_LIMITED" },
  },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("public-api-bulk"),
  keyGenerator: (req) => req.apiKey?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// GET /api/v1/openapi.json — the spec itself must be fetchable without a key
// (chicken-and-egg for anyone integrating for the first time), so this is
// registered before the auth middleware below.
publicApiRouter.get("/openapi.json", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json(buildOpenApiDocument(baseUrl));
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

// POST /api/v1/orders/:trackingId/cancel — cancel your own order (requires
// UUID Idempotency-Key header). Only allowed from the same pre-pickup states
// the dashboard allows a vendor to cancel from; enforced inside updateParcelStatus.
publicApiRouter.post(
  "/orders/:trackingId/cancel",
  publicWriteLimiter,
  validate(publicCancelOrderSchema),
  publicCancelOrderController,
);

// POST /api/v1/orders/statuses — bulk status lookup for reconciliation
// (up to 100 tracking ids per call), so polling doesn't burn the per-order read budget.
publicApiRouter.post(
  "/orders/statuses",
  publicBulkLimiter,
  validate(publicBulkStatusSchema),
  publicBulkOrderStatusController,
);

// GET /api/v1/rates — your full rate card across all destinations.
publicApiRouter.get("/rates", publicReadLimiter, publicGetRatesController);

// GET /api/v1/rates/quote — a single-destination quote before booking.
publicApiRouter.get(
  "/rates/quote",
  publicReadLimiter,
  validate(publicQuoteQuerySchema, "query"),
  publicGetRateQuoteController,
);

// GET /api/v1/orders/:trackingId/remarks — read the comment thread on your order.
publicApiRouter.get(
  "/orders/:trackingId/remarks",
  publicReadLimiter,
  publicListRemarksController,
);

// POST /api/v1/orders/:trackingId/remarks — add a comment (requires UUID Idempotency-Key header).
publicApiRouter.post(
  "/orders/:trackingId/remarks",
  publicWriteLimiter,
  validate(publicAddRemarkSchema),
  publicAddRemarkController,
);

// POST /api/v1/tickets — open a support ticket (requires UUID Idempotency-Key header).
publicApiRouter.post(
  "/tickets",
  publicWriteLimiter,
  validate(publicCreateTicketSchema),
  publicCreateTicketController,
);

// GET /api/v1/tickets — list your own tickets (status/priority/category/date filters).
publicApiRouter.get(
  "/tickets",
  publicReadLimiter,
  validate(listTicketsQuerySchema, "query"),
  publicListTicketsController,
);

// GET /api/v1/tickets/:id — ticket detail + reply thread.
publicApiRouter.get("/tickets/:id", publicReadLimiter, publicGetTicketController);

// POST /api/v1/tickets/:id/replies — reply on your own ticket (requires UUID Idempotency-Key header).
publicApiRouter.post(
  "/tickets/:id/replies",
  publicWriteLimiter,
  validate(publicTicketReplySchema),
  publicAddTicketReplyController,
);

// Express's default 404 responds with HTML; API clients should always get JSON.
publicApiRouter.use((_req, res) => {
  res.status(404).json({ success: false, message: "Not found", error: { code: "NOT_FOUND" } });
});

export default publicApiRouter;
