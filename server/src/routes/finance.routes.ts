import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { parseMultipartJson } from "../middlewares/multipartJson.middleware";
import { settlementDocsUpload } from "../lib/settlementUpload";
import {
  pendingCodQuerySchema,
  orderCodQuerySchema,
  settlementsQuerySchema,
  createSettlementSchema,
  paySettlementSchema,
  updateSettlementSchema,
  revertSettlementSchema,
  cancelSettlementSchema,
} from "../validators/finance.schema";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getPendingCodController,
  listOrderCodController,
  listSettlementsController,
  getUnsettledOrdersController,
  createSettlementController,
  payForSettlementController,
  updateSettlementController,
  revertSettlementController,
  cancelSettlementController,
  getSettlementDetailController,
  getSettlementDocumentController,
} from "../controllers/finance.controller";

const financeRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const financeReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("finance-read"),
  keyGenerator: actorOrIpKey,
});

const settlementCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many settlements created, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("finance-settlement-create"),
  keyGenerator: actorOrIpKey,
});

// GET /api/finance/pending-cod — vendor's pending COD billing statement
financeRouter.get(
  "/pending-cod",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "sales"),
  requireStaffPermission("FINANCE_ACCESS"),
  financeReadLimiter,
  validate(pendingCodQuerySchema, "query"),
  getPendingCodController,
);

// GET /api/finance/order-cod — per-order COD payment status, settled vs not settled
financeRouter.get(
  "/order-cod",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "sales"),
  requireStaffPermission("FINANCE_ACCESS"),
  financeReadLimiter,
  validate(orderCodQuerySchema, "query"),
  listOrderCodController,
);

// GET /api/finance/settlements — historical settlement statements (rider or vendor)
financeRouter.get(
  "/settlements",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("FINANCE_ACCESS"),
  financeReadLimiter,
  validate(settlementsQuerySchema, "query"),
  listSettlementsController,
);

// GET /api/finance/settlements/:id — line-item detail (orders) for one statement
financeRouter.get(
  "/settlements/:id",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("FINANCE_ACCESS"),
  financeReadLimiter,
  getSettlementDetailController,
);

// GET /api/finance/settlements/:id/documents/:kind — payment receipt / tax
// invoice for one statement. Same audience as the detail route above, so the
// payee reaches their own paperwork; the /uploads mount stays admin-only.
financeRouter.get(
  "/settlements/:id/documents/:kind",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "rider", "sales"),
  requireStaffPermission("FINANCE_ACCESS"),
  financeReadLimiter,
  getSettlementDocumentController,
);

// POST /api/finance/settlements — create + immediately settle a statement
// bundling selected pending cod_collections for a rider or vendor
financeRouter.post(
  "/settlements",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  settlementCreateLimiter,
  validate(createSettlementSchema),
  createSettlementController,
);

// POST /api/finance/settlements/:id/pay — record payment against a pending
// statement and flip it to settled. Multipart: optional payment receipt and
// tax invoice alongside the payment rows.
financeRouter.post(
  "/settlements/:id/pay",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  settlementCreateLimiter,
  settlementDocsUpload,
  parseMultipartJson("payments"),
  validate(paySettlementSchema),
  payForSettlementController,
);

// PATCH /api/finance/settlements/:id — correct an unsettled statement's order
// list (super_admin always allowed; a plain admin needs EDIT_SETTLEMENTS)
financeRouter.patch(
  "/settlements/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("EDIT_SETTLEMENTS"),
  settlementCreateLimiter,
  validate(updateSettlementSchema),
  updateSettlementController,
);

// POST /api/finance/settlements/:id/revert — undo a mistaken "Make Payment"
// action: flips a settled statement back to pending (super_admin always
// allowed; a plain admin needs EDIT_SETTLEMENTS, same gate as editing)
financeRouter.post(
  "/settlements/:id/revert",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("EDIT_SETTLEMENTS"),
  settlementCreateLimiter,
  validate(revertSettlementSchema),
  revertSettlementController,
);

// POST /api/finance/settlements/:id/cancel — cancel a pending (unpaid)
// statement, releasing its bundled orders back for a future statement (super_admin
// always allowed; a plain admin needs EDIT_SETTLEMENTS, same gate as editing/revert)
financeRouter.post(
  "/settlements/:id/cancel",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("EDIT_SETTLEMENTS"),
  settlementCreateLimiter,
  validate(cancelSettlementSchema),
  cancelSettlementController,
);

// GET /api/finance/unsettled-orders — unsettled COD orders for rider or vendor
financeRouter.get(
  "/unsettled-orders",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "rider", "sales"),
  requireStaffPermission("FINANCE_ACCESS"),
  financeReadLimiter,
  getUnsettledOrdersController,
);

export default financeRouter;
