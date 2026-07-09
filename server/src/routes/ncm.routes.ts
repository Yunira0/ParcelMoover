import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { ncmHandoffSchema, ncmWebhookRegisterSchema } from "../validators/ncm.schema";
import {
  getNcmParcelInfoController,
  listNcmBranchesController,
  ncmHandoffController,
  ncmReconcileController,
  ncmWebhookController,
  registerNcmWebhookController,
} from "../controllers/ncm.controller";

const ncmRouter: Router = Router();

const ncmReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("ncm-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Handoff creates real orders on NCM's side (their limit: 1,000/day), so this
// is deliberately tighter than the usual write limiter.
const ncmWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("ncm-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Inbound webhooks are IP-keyed (no auth user) — generous enough for NCM's
// burst deliveries, tight enough to blunt secret-guessing on the path.
const ncmWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("ncm-webhook"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

// GET /api/ncm/branches — NCM branch list for the handoff dialog (cached 1h).
ncmRouter.get(
  "/branches",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  ncmReadLimiter,
  listNcmBranchesController,
);

// POST /api/ncm/handoff — create NCM orders for oov parcels (OOV page "Via 3PL").
ncmRouter.post(
  "/handoff",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  ncmWriteLimiter,
  validate(ncmHandoffSchema),
  ncmHandoffController,
);

// GET /api/ncm/parcels/:parcelId — NCM order id + live status for one parcel.
ncmRouter.get(
  "/parcels/:parcelId",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  ncmReadLimiter,
  getNcmParcelInfoController,
);

// POST /api/ncm/reconcile — manually trigger the missed-webhook sweep.
ncmRouter.post(
  "/reconcile",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  ncmWriteLimiter,
  ncmReconcileController,
);

// POST /api/ncm/webhook/register — tell NCM where to send status webhooks.
ncmRouter.post(
  "/webhook/register",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  ncmWriteLimiter,
  validate(ncmWebhookRegisterSchema),
  registerNcmWebhookController,
);

// POST /api/ncm/webhook/:secret — public receiver for NCM status pushes.
// No auth/CSRF: NCM can't send either; the secret path segment (compared in
// constant time in the controller) is the authentication.
ncmRouter.post("/webhook/:secret", ncmWebhookLimiter, ncmWebhookController);

export default ncmRouter;
