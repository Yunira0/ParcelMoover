import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  getRemarkByIdController,
  listRemarksController,
  setRemarkStatusController,
  getUnclosedRemarksCountController,
} from "../controllers/remark.controller";
import { validate } from "../middlewares/validate.middleware";
import { listRemarksQuerySchema } from "../validators/remark.schema";
import { uuidParamSchema } from "../validators/common";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const remarkRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const remarksReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("remarks-read"),
  keyGenerator: actorOrIpKey,
});

const remarksWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("remarks-write"),
  keyGenerator: actorOrIpKey,
});

// Vendors and their staff see remarks on their parcels; admins see all (scoped in the service).
const CX_ROLES = ["super_admin", "admin", "vendor", "vendor_staff", "sales"] as const;

// GET /api/remarks — list remarks (status/date/search filters; vendor-scoped)
remarkRouter.get(
  "/",
  authMiddleware,
  authorizeRoles(...CX_ROLES),
  remarksReadLimiter,
  validate(listRemarksQuerySchema, "query"),
  listRemarksController,
);

// GET /api/remarks/unclosed/count — count of unclosed remarks (must be before /:id)
remarkRouter.get(
  "/unclosed/count",
  authMiddleware,
  authorizeRoles(...CX_ROLES),
  remarksReadLimiter,
  getUnclosedRemarksCountController,
);

// GET /api/remarks/:id — single remark + its conversation thread (read-only; the
// client explicitly calls PATCH .../status to move a pending remark to Open)
remarkRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles(...CX_ROLES),
  remarksReadLimiter,
  validate(uuidParamSchema, "params"),
  getRemarkByIdController,
);

// PATCH /api/remarks/:id/status — set Open / Pending / Closed (e.g. Mark as Done / on reply)
remarkRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...CX_ROLES),
  remarksWriteLimiter,
  setRemarkStatusController,
);

export default remarkRouter;
