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
  branchSettlementIdSchema, branchSettlementQuerySchema, branchTrackingQuerySchema, createBranchSchema, updateBranchSchema,
  branchBillingPaymentSchema, branchBillingQuerySchema, branchBillingReviewSchema, createBranchSettlementSchema, payBranchSettlementSchema,
} from "../validators/branch.schema";
import {
  branchOrdersController, branchOrdersExportController, branchOverviewController, createBranchController,
  createBranchSettlementController, getBranchSettlementController, listBranchesController,
  getBranchBillingStatusController, listBranchBalancesController, listBranchPaymentsController, listBranchSettlementsController,
  payBranchSettlementController, reviewBranchPaymentController, submitBranchPaymentController, updateBranchController,
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
// accountant reaches only the COD settlement and billing endpoints below;
// branch tracking/management routes re-gate to staffOnly, because
// requireAdminPermission passes any non-admin role straight through.
router.use(authMiddleware, authorizeRoles("super_admin", "admin", "accountant"));
const staffOnly = authorizeRoles("super_admin", "admin");
// The accountant also builds branch COD statements, which needs the order picker.
const staffOrAccountant = authorizeRoles("super_admin", "admin", "accountant");

// The branch directory is also needed by an assigned branch admin when
// creating a settlement. The workflow middleware scopes their actual data.
router.get("/", branchReadLimiter, requireBranchWorkflowAccess, listBranchesController);
router.get("/overview", staffOnly, branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOverviewController);
// A branch workspace admin reaches this to pick orders for its own COD
// statement; listBranchOrders pins them to their own branch. Cross-branch
// access still needs BRANCH_TRACKING_READ, enforced in the service.
router.get("/orders", staffOrAccountant, branchReadLimiter, requireBranchWorkflowAccess, validate(branchTrackingQuerySchema, "query"), branchOrdersController);
router.get("/orders/export", staffOnly, branchReadLimiter, requireAdminPermission("BRANCH_TRACKING_READ"), validate(branchTrackingQuerySchema, "query"), branchOrdersExportController);
router.post("/", staffOnly, csrfProtection, branchWriteLimiter, requireAdminPermission("BRANCH_TRACKING_WRITE"), validate(createBranchSchema), createBranchController);
router.patch("/:id", staffOnly, csrfProtection, branchWriteLimiter, requireAdminPermission("BRANCH_TRACKING_WRITE"), validate(branchSettlementIdSchema, "params"), validate(updateBranchSchema), updateBranchController);
router.get("/settlements", branchReadLimiter, requireBranchWorkflowAccess, validate(branchSettlementQuerySchema, "query"), listBranchSettlementsController);
router.post("/settlements", staffOrAccountant, csrfProtection, branchWriteLimiter, requireBranchWorkflowAccess, validate(createBranchSettlementSchema), createBranchSettlementController);
router.get("/settlements/:id", branchReadLimiter, requireBranchWorkflowAccess, validate(branchSettlementIdSchema, "params"), getBranchSettlementController);
// Office-recorded settlement payment: super_admin or accountant, matching payBranchSettlement.
router.post("/settlements/:id/pay", csrfProtection, branchWriteLimiter, authorizeRoles("super_admin", "accountant"), validate(branchSettlementIdSchema, "params"), validate(payBranchSettlementSchema), payBranchSettlementController);
// Branch credit control. A branch account can submit its own proof, while the
// office review queue is available to branch-tracking staff.
router.get("/billing/status", branchReadLimiter, requireBranchWorkflowAccess, validate(branchBillingQuerySchema, "query"), getBranchBillingStatusController);
router.get("/billing/balances", branchReadLimiter, authorizeRoles("super_admin", "accountant"), listBranchBalancesController);
router.get("/billing/payments", branchReadLimiter, requireBranchWorkflowAccess, validate(branchBillingQuerySchema, "query"), listBranchPaymentsController);
router.post("/billing/payments", staffOnly, csrfProtection, branchWriteLimiter, requireBranchWorkflowAccess, paymentProofUpload, validate(branchBillingPaymentSchema), submitBranchPaymentController);
router.patch("/billing/payments/:id/review", csrfProtection, branchWriteLimiter, requireBranchWorkflowAccess, validate(branchSettlementIdSchema, "params"), validate(branchBillingReviewSchema), reviewBranchPaymentController);

export default router;
