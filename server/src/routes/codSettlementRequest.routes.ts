import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  createCodSettlementRequestSchema,
  listCodSettlementRequestsQuerySchema,
  updateCodSettlementRequestStatusSchema,
} from "../validators/codSettlementRequest.schema";
import {
  createCodSettlementRequestController,
  getCodSettlementRequestController,
  listCodSettlementRequestsController,
  updateCodSettlementRequestStatusController,
} from "../controllers/codSettlementRequest.controller";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const codSettlementRequestRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("cod-settlement-requests-read"),
  keyGenerator: actorOrIpKey,
});

// Deliberately tighter than the ticket create limiter. A vendor can hold only
// one live request anyway, so anything past a couple of attempts a minute is
// either a mistake or someone probing.
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many COD settlement requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("cod-settlement-requests-create"),
  keyGenerator: actorOrIpKey,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("cod-settlement-requests-write"),
  keyGenerator: actorOrIpKey,
});

// Vendors raise and track their own; staff see and action every one.
const READ_ROLES = ["super_admin", "admin", "vendor", "vendor_staff"] as const;
const CREATE_ROLES = ["vendor", "vendor_staff"] as const;
const ACTION_ROLES = ["super_admin", "admin"] as const;

// GET /api/cod-settlement-requests — list (vendor-scoped in the service)
codSettlementRequestRouter.get(
  "/",
  authMiddleware,
  authorizeRoles(...READ_ROLES),
  readLimiter,
  validate(listCodSettlementRequestsQuerySchema, "query"),
  listCodSettlementRequestsController,
);

// GET /api/cod-settlement-requests/:id — one request
codSettlementRequestRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles(...READ_ROLES),
  readLimiter,
  getCodSettlementRequestController,
);

// POST /api/cod-settlement-requests — raise one (refused while one is live)
codSettlementRequestRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...CREATE_ROLES),
  createLimiter,
  validate(createCodSettlementRequestSchema),
  createCodSettlementRequestController,
);

// PATCH /api/cod-settlement-requests/:id/status — staff move it along
codSettlementRequestRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...ACTION_ROLES),
  writeLimiter,
  validate(updateCodSettlementRequestStatusSchema),
  updateCodSettlementRequestStatusController,
);

export default codSettlementRequestRouter;
