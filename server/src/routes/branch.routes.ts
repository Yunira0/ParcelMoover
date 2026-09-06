import { type Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  branchSettlementQuerySchema, branchTrackingQuerySchema, createBranchSchema, createBranchSettlementSchema,
} from "../validators/branch.schema";
import {
  branchOrdersController, branchOrdersExportController, branchOverviewController, createBranchController,
  createBranchSettlementController, listBranchesController, listBranchSettlementsController,
} from "../controllers/branch.controller";

const router = Router();
const actorOrIp = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");
const branchReadLimiter = rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
  passOnStoreError: true, validate: false, keyGenerator: actorOrIp,
  store: createRedisRateLimitStore("branch-read"),
  message: { success: false, message: "Too many branch report requests" },
});
const branchWriteLimiter = rateLimit({
  windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
  passOnStoreError: true, validate: false, keyGenerator: actorOrIp,
  store: createRedisRateLimitStore("branch-write"),
  message: { success: false, message: "Too many branch write requests" },
});
router.use(authMiddleware, authorizeRoles("super_admin", "admin"));

router.get("/", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), listBranchesController);
router.get("/overview", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOverviewController);
router.get("/orders", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOrdersController);
router.get("/orders/export", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOrdersExportController);
router.post("/", csrfProtection, branchWriteLimiter, requireAdminPermission("BRANCH_TRACKING_WRITE"), validate(createBranchSchema), createBranchController);
router.get("/settlements", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchSettlementQuerySchema, "query"), listBranchSettlementsController);
router.post("/settlements", csrfProtection, branchWriteLimiter, requireAdminPermission("BRANCH_TRACKING_WRITE"), validate(createBranchSettlementSchema), createBranchSettlementController);

export default router;
