import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { createApiKeySchema } from "../validators/apiKey.schema";
import { uuidParamSchema } from "../validators/common";
import {
  createApiKeyController,
  listApiKeysController,
  revokeApiKeyController,
} from "../controllers/apiKey.controller";

// Vendor self-service management of partner API keys (the dashboard side).
// The keys themselves authenticate the separate public /api/v1 surface.
const apiKeyRouter: Router = Router();

const apiKeyReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("apikey-mgmt-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const apiKeyWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("apikey-mgmt-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Vendor owners only — vendor_staff deliberately cannot mint or revoke keys
// that act with the full authority of the vendor account.
apiKeyRouter.use(authMiddleware, authorizeRoles("vendor"));

// GET /api/api-keys — list own keys (prefix + metadata only, never the hash).
apiKeyRouter.get("/", apiKeyReadLimiter, listApiKeysController);

// POST /api/api-keys — mint a key; plaintext is returned once in this response.
apiKeyRouter.post(
  "/",
  csrfProtection,
  apiKeyWriteLimiter,
  validate(createApiKeySchema),
  createApiKeyController,
);

// DELETE /api/api-keys/:id — revoke (soft: sets revoked_at, evicts auth cache).
apiKeyRouter.delete(
  "/:id",
  csrfProtection,
  apiKeyWriteLimiter,
  validate(uuidParamSchema, "params"),
  revokeApiKeyController,
);

export default apiKeyRouter;
