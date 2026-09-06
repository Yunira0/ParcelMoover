import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  createTransitManifestSchema,
  listTransitManifestsQuerySchema,
  transitScanSchema,
} from "../validators/transitManifest.schema";
import {
  addTransitManifestParcelsController,
  createTransitManifestController,
  getTransitManifestController,
  listTransitManifestsController,
  receiveTransitManifestParcelsController,
} from "../controllers/transitManifest.controller";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const transitManifestRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("transit-manifests-read"),
  keyGenerator: actorOrIpKey,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("transit-manifests-write"),
  keyGenerator: actorOrIpKey,
});

// Tighter than the write limiter: each scan fans out into a status change
// across up to 200 parcels, with the dispatch and COD writes that entails.
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many manifest hand-overs, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("transit-manifests-action"),
  keyGenerator: actorOrIpKey,
});

// Hub operations (dispatch, transit transitions) are admin-only throughout -
// the same rule the parcel statuses themselves enforce via
// HUB_OPERATION_STATUSES in order.service.
const MANIFEST_ROLES = ["super_admin", "admin"] as const;

// GET /api/transit-manifests — paged list
transitManifestRouter.get(
  "/",
  authMiddleware,
  authorizeRoles(...MANIFEST_ROLES),
  readLimiter,
  validate(listTransitManifestsQuerySchema, "query"),
  listTransitManifestsController,
);

// GET /api/transit-manifests/:id — one manifest with its parcels
transitManifestRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles(...MANIFEST_ROLES),
  readLimiter,
  getTransitManifestController,
);

// POST /api/transit-manifests — open one for a route
transitManifestRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  writeLimiter,
  validate(createTransitManifestSchema),
  createTransitManifestController,
);

// POST /api/transit-manifests/:id/parcels — scan oov parcels on → dispatched
transitManifestRouter.post(
  "/:id/parcels",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  actionLimiter,
  validate(transitScanSchema),
  addTransitManifestParcelsController,
);

// POST /api/transit-manifests/:id/receive — scan dispatched parcels in → arrived_at_branch
transitManifestRouter.post(
  "/:id/receive",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  actionLimiter,
  validate(transitScanSchema),
  receiveTransitManifestParcelsController,
);

export default transitManifestRouter;
