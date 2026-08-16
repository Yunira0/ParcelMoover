import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { upayaHandoffSchema } from "../validators/upaya.schema";
import {
  getUpayaParcelInfoController,
  listUpayaDeliveryAreasController,
  listUpayaLocationsController,
  upayaHandoffController,
  upayaReconcileController,
  upayaWebhookController,
} from "../controllers/upaya.controller";

const upayaRouter: Router = Router();

const upayaReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("upaya-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Handoff creates real orders on Upaya's side, same caution as NCM's tighter
// write limiter.
const upayaWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("upaya-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Inbound webhooks are IP-keyed (no auth user) — generous enough for burst
// deliveries, tight enough to blunt secret-guessing on the path.
const upayaWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("upaya-webhook"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

// GET /api/upaya/locations — Upaya's raw location/area network (cached 1h),
// for diagnostics (handoff auto-matches an area per parcel, so the UI
// doesn't call this).
upayaRouter.get(
  "/locations",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  upayaReadLimiter,
  listUpayaLocationsController,
);

// POST /api/upaya/handoff — create Upaya orders for oov parcels (OOV page "Via 3PL").
// area_id is auto-matched per parcel from its destination hub - see matchUpayaArea.
upayaRouter.post(
  "/handoff",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  upayaWriteLimiter,
  validate(upayaHandoffSchema),
  upayaHandoffController,
);

// GET /api/upaya/parcels/:parcelId — Upaya order id + live status for one parcel.
upayaRouter.get(
  "/parcels/:parcelId",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  upayaReadLimiter,
  getUpayaParcelInfoController,
);

// POST /api/upaya/reconcile — manually trigger the missed-webhook sweep.
upayaRouter.post(
  "/reconcile",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  upayaWriteLimiter,
  upayaReconcileController,
);

// GET /api/upaya/delivery-areas — every delivery area across Upaya's network
// (live, Redis-cached 1h), flattened, for diagnostics (e.g. checking why a
// destination didn't auto-match) — same "not called by the UI" status as
// /locations above, now that handoff matches areas automatically.
upayaRouter.get(
  "/delivery-areas",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  upayaReadLimiter,
  listUpayaDeliveryAreasController,
);

// POST /api/upaya/webhook/:secret — public receiver for Upaya order_status/comment pushes.
// No auth/CSRF: Upaya can't send either; the secret path segment (compared in
// constant time in the controller) is the authentication.
upayaRouter.post("/webhook/:secret", upayaWebhookLimiter, upayaWebhookController);

export default upayaRouter;
