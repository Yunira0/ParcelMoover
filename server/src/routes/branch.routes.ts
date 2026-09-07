import { type Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { requireBranchWorkflowAccess } from "../middlewares/branchWorkflowAccess.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { paymentProofUpload } from "../lib/billingUpload";
import {
  branchSettlementIdSchema, branchSettlementQuerySchema, branchTrackingQuerySchema, createBranchSchema,
  branchBillingPaymentSchema, branchBillingQuerySchema, branchBillingReviewSchema, createBranchSettlementSchema, payBranchSettlementSchema,
} from "../validators/branch.schema";
import {
  branchOrdersController, branchOrdersExportController, branchOverviewController, createBranchController,
  createBranchSettlementController, getBranchSettlementController, listBranchesController,
  getBranchBillingStatusController, listBranchBalancesController, listBranchPaymentsController, listBranchSettlementsController,
  payBranchSettlementController, reviewBranchPaymentController, submitBranchPaymentController,
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

// The branch directory is also needed by an assigned branch admin when
// creating a settlement. The workflow middleware scopes their actual data.
router.get("/", branchReadLimiter, requireBranchWorkflowAccess, listBranchesController);
router.get("/overview", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOverviewController);
router.get("/orders", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOrdersController);
router.get("/orders/export", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOrdersExportController);
router.post("/", csrfProtection, branchWriteLimiter, requireAdminPermission("BRANCH_TRACKING_WRITE"), validate(createBranchSchema), createBranchController);
router.get("/settlements", branchReadLimiter, requireBranchWorkflowAccess, validate(branchSettlementQuerySchema, "query"), listBranchSettlementsController);
router.post("/settlements", csrfProtection, branchWriteLimiter, requireBranchWorkflowAccess, validate(createBranchSettlementSchema), createBranchSettlementController);
router.get("/settlements/:id", branchReadLimiter, requireBranchWorkflowAccess, validate(branchSettlementIdSchema, "params"), getBranchSettlementController);
router.post("/settlements/:id/pay", csrfProtection, branchWriteLimiter, requireAdminPermission("BRANCH_TRACKING_WRITE"), validate(branchSettlementIdSchema, "params"), validate(payBranchSettlementSchema), payBranchSettlementController);
// Branch credit control. A branch account can submit its own proof, while the
// office review queue is available to branch-tracking staff.
router.get("/billing/status", branchReadLimiter, requireBranchWorkflowAccess, validate(branchBillingQuerySchema, "query"), getBranchBillingStatusController);
router.get("/billing/balances", branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), listBranchBalancesController);
router.get("/billing/payments", branchReadLimiter, requireBranchWorkflowAccess, validate(branchBillingQuerySchema, "query"), listBranchPaymentsController);
router.post("/billing/payments", csrfProtection, branchWriteLimiter, requireBranchWorkflowAccess, paymentProofUpload, validate(branchBillingPaymentSchema), submitBranchPaymentController);
router.patch("/billing/payments/:id/review", csrfProtection, branchWriteLimiter, requireBranchWorkflowAccess, validate(branchSettlementIdSchema, "params"), validate(branchBillingReviewSchema), reviewBranchPaymentController);

export default router;
