import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  addManifestParcelsSchema,
  createReturnManifestSchema,
  listReturnManifestsQuerySchema,
  openReturnManifestQuerySchema,
  receiveReturnManifestSchema,
  sendReturnManifestSchema,
} from "../validators/returnManifest.schema";
import {
  addManifestParcelsController,
  createReturnManifestController,
  getOpenReturnManifestController,
  getReturnManifestController,
  listReturnManifestsController,
  receiveReturnManifestController,
  removeManifestParcelController,
  sendReturnManifestController,
} from "../controllers/returnManifest.controller";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const returnManifestRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("return-manifests-read"),
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
  store: createRedisRateLimitStore("return-manifests-write"),
  keyGenerator: actorOrIpKey,
});

// Tighter than the write limiter: each of these fans out into a status change
// across up to 200 parcels, with the re-pricing and COD writes that entails.
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many manifest hand-overs, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("return-manifests-action"),
  keyGenerator: actorOrIpKey,
});

// The return workflow is staff-only throughout - the same rule the parcel
// statuses themselves enforce via RETURN_WORKFLOW_STATUSES in order.service.
const MANIFEST_ROLES = ["super_admin", "admin"] as const;

// GET /api/return-manifests — paged list
returnManifestRouter.get(
  "/",
  authMiddleware,
  authorizeRoles(...MANIFEST_ROLES),
  readLimiter,
  validate(listReturnManifestsQuerySchema, "query"),
  listReturnManifestsController,
);

// GET /api/return-manifests/open?vendorId= — the vendor's open manifest, if any.
// Declared before "/:id" so Express doesn't read "open" as a manifest id.
returnManifestRouter.get(
  "/open",
  authMiddleware,
  authorizeRoles(...MANIFEST_ROLES),
  readLimiter,
  validate(openReturnManifestQuerySchema, "query"),
  getOpenReturnManifestController,
);

// GET /api/return-manifests/:id — one manifest with its parcels
returnManifestRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles(...MANIFEST_ROLES),
  readLimiter,
  getReturnManifestController,
);

// POST /api/return-manifests — open one (refused while the vendor has an open one)
returnManifestRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  writeLimiter,
  validate(createReturnManifestSchema),
  createReturnManifestController,
);

// POST /api/return-manifests/:id/parcels — add ready-to-return parcels
returnManifestRouter.post(
  "/:id/parcels",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  writeLimiter,
  validate(addManifestParcelsSchema),
  addManifestParcelsController,
);

// DELETE /api/return-manifests/:id/parcels/:parcelId — pull one back out
returnManifestRouter.delete(
  "/:id/parcels/:parcelId",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  writeLimiter,
  removeManifestParcelController,
);

// POST /api/return-manifests/:id/send — hand to a rider → sent_to_vendor
returnManifestRouter.post(
  "/:id/send",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  actionLimiter,
  validate(sendReturnManifestSchema),
  sendReturnManifestController,
);

// POST /api/return-manifests/:id/receive — vendor signed → returned_to_vendor
returnManifestRouter.post(
  "/:id/receive",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...MANIFEST_ROLES),
  actionLimiter,
  validate(receiveReturnManifestSchema),
  receiveReturnManifestController,
);

export default returnManifestRouter;
