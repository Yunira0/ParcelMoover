import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  bulkImportLocationsController,
  createLocationController,
  deleteLocationController,
  listManagedLocationsController,
  updateLocationController,
} from "../controllers/location.controller";

const locationRouter: Router = Router();

const locationsReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("locations-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const locationsWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("locations-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// Bulk import handles a whole spreadsheet at once, so it gets a tighter cap
// than ordinary single-row writes.
const locationsBulkImportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("locations-bulk-import"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// GET /api/locations — destinations with their nested covered areas (Settings screen)
locationRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  locationsReadLimiter,
  listManagedLocationsController,
);

// POST /api/locations — create a destination or a covered area (parentId set)
locationRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  locationsWriteLimiter,
  createLocationController,
);

// POST /api/locations/bulk-import — upsert destinations+areas from an Excel/CSV upload
locationRouter.post(
  "/bulk-import",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  locationsBulkImportLimiter,
  bulkImportLocationsController,
);

// PATCH /api/locations/:id — edit a destination/area or toggle its active state
locationRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  locationsWriteLimiter,
  updateLocationController,
);

// DELETE /api/locations/:id — remove a destination (and its areas) or a single area
locationRouter.delete(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SETTINGS_ACCESS"),
  locationsWriteLimiter,
  deleteLocationController,
);

export default locationRouter;
