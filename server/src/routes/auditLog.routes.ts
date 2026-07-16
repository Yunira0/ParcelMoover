import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { listAuditLogsQuerySchema } from "../validators/auditLog.schema";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getAuditLogFilterOptionsController,
  listAuditLogsController,
} from "../controllers/auditLog.controller";

const auditLogRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const auditLogReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("audit-log-read"),
  keyGenerator: actorOrIpKey,
});

// System logs expose actor identity and raw before/after payloads (order
// amounts, PII) across every entity in the app - super_admin, or an admin a
// super_admin explicitly delegated SYSTEM_LOGS_ACCESS to.
const systemLogsAccess = [
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("SYSTEM_LOGS_ACCESS"),
] as const;

// GET /api/audit-logs — filter dropdown options (entity types, actions in use)
auditLogRouter.get(
  "/filter-options",
  authMiddleware,
  ...systemLogsAccess,
  auditLogReadLimiter,
  getAuditLogFilterOptionsController,
);

// GET /api/audit-logs — list (entity type/action/date/search filters, paginated)
auditLogRouter.get(
  "/",
  authMiddleware,
  ...systemLogsAccess,
  auditLogReadLimiter,
  validate(listAuditLogsQuerySchema, "query"),
  listAuditLogsController,
);

export default auditLogRouter;
