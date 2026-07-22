import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { uuidParamSchema } from "../validators/common";
import {
  createWebhookEndpointSchema,
  deliveryParamSchema,
  listDeliveriesQuerySchema,
  updateWebhookEndpointSchema,
} from "../validators/webhook.schema";
import {
  createWebhookEndpointController,
  deleteWebhookEndpointController,
  listWebhookDeliveriesController,
  listWebhookEndpointsController,
  regenerateWebhookSecretController,
  retryWebhookDeliveryController,
  sendTestWebhookEventController,
  updateWebhookEndpointController,
} from "../controllers/webhookEndpoint.controller";

// Vendor self-service management of outbound webhook endpoints (the
// dashboard side). Delivery itself runs off the sweep in index.ts.
const webhookRouter: Router = Router();

const webhookReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("webhook-mgmt-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const webhookWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("webhook-mgmt-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Vendor owners only — same rationale as api_keys: a credential with the
// full authority of the vendor account shouldn't be mintable by staff.
webhookRouter.use(authMiddleware, authorizeRoles("vendor"));

// GET /api/webhooks — list own endpoints (never the decrypted secret).
webhookRouter.get("/", webhookReadLimiter, listWebhookEndpointsController);

// POST /api/webhooks — register an endpoint; plaintext secret returned once.
webhookRouter.post(
  "/",
  csrfProtection,
  webhookWriteLimiter,
  validate(createWebhookEndpointSchema),
  createWebhookEndpointController,
);

// PATCH /api/webhooks/:id — update name/url/eventTypes/enabled.
webhookRouter.patch(
  "/:id",
  csrfProtection,
  webhookWriteLimiter,
  validate(uuidParamSchema, "params"),
  validate(updateWebhookEndpointSchema),
  updateWebhookEndpointController,
);

// DELETE /api/webhooks/:id
webhookRouter.delete(
  "/:id",
  csrfProtection,
  webhookWriteLimiter,
  validate(uuidParamSchema, "params"),
  deleteWebhookEndpointController,
);

// POST /api/webhooks/:id/regenerate-secret — new plaintext secret, shown once.
webhookRouter.post(
  "/:id/regenerate-secret",
  csrfProtection,
  webhookWriteLimiter,
  validate(uuidParamSchema, "params"),
  regenerateWebhookSecretController,
);

// POST /api/webhooks/:id/test — queue a synthetic "webhook.test" event.
webhookRouter.post(
  "/:id/test",
  csrfProtection,
  webhookWriteLimiter,
  validate(uuidParamSchema, "params"),
  sendTestWebhookEventController,
);

// GET /api/webhooks/:id/deliveries — recent delivery attempts, paginated.
webhookRouter.get(
  "/:id/deliveries",
  webhookReadLimiter,
  validate(uuidParamSchema, "params"),
  validate(listDeliveriesQuerySchema, "query"),
  listWebhookDeliveriesController,
);

// POST /api/webhooks/:id/deliveries/:deliveryId/retry — manual re-queue.
webhookRouter.post(
  "/:id/deliveries/:deliveryId/retry",
  csrfProtection,
  webhookWriteLimiter,
  validate(deliveryParamSchema, "params"),
  retryWebhookDeliveryController,
);

export default webhookRouter;
