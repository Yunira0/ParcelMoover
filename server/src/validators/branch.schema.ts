import { z } from "zod";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const BRANCH_METRIC_KEYS = [
  "totalOrders", "inTransit", "pendingDelivery", "totalDelivered",
  "returnProcessing", "returned", "hold", "failed", "deposited",
  "pendingDeposit",
] as const;

export const branchTrackingQuerySchema = z.object({
  fromBranchId: uuid.optional(),
  toBranchId: uuid.optional(),
  dateFrom: day.optional(),
  dateTo: day.optional(),
  metric: z.enum(BRANCH_METRIC_KEYS).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(400).optional(),
  dir: z.enum(["next", "prev"]).optional(),
  // Creation picker only: hide parcels already earmarked by any branch
  // statement, even though pending statements still belong in Pending Deposit.
  availableForSettlement: z.enum(["true"]).transform(() => true).optional(),
}).superRefine((value, ctx) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    ctx.addIssue({ code: "custom", path: ["dateTo"], message: "Date to must be on or after date from" });
  }
});

export const createBranchSchema = z.object({
  locationId: uuid,
  coveredAreaIds: z.array(uuid).max(500).default([]),
  // Other existing branches this one also covers - a side relationship
  // (branch_virtual_coverage), not a re-parenting: the covered branch keeps
  // its own is_hub/routing/pricing untouched. See resolveBranchLocationIds.
  virtualBranchIds: z.array(uuid).max(50).default([]),
  commissionPerParcel: z.coerce.number().min(0).max(1_000_000),
});

export const branchSettlementQuerySchema = z.object({
  fromBranchId: uuid.optional(),
  toBranchId: uuid.optional(),
  dateFrom: day.optional(),
  dateTo: day.optional(),
  status: z.enum(["pending", "partially_paid", "settled", "cancelled"]).optional(),
  // A branch can inspect statements it owes, statements another branch owes
  // it, or both. Only its own branch ever participates in this scope.
  scope: z.enum(["outgoing", "incoming", "all"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createBranchSettlementSchema = z.object({
  fromBranchId: uuid,
  toBranchId: uuid,
  settlementDate: day,
  orderIds: z.array(uuid).min(1).max(500),
  commissionPerParcel: z.coerce.number().min(0).max(1_000_000).optional(),
  paymentMethod: z.string().trim().max(100).optional(),
  remark: z.string().trim().max(500).optional(),
}).refine((v) => v.fromBranchId !== v.toBranchId, {
  path: ["toBranchId"], message: "From and to branches must be different",
});

export const payBranchSettlementSchema = z.object({
  payments: z.array(z.object({
    method: z.string().trim().min(1).max(100),
    amount: z.coerce.number().min(0).max(1_000_000_000),
  })).min(1).max(10),
  remark: z.string().trim().max(500).optional(),
});

export const branchSettlementIdSchema = z.object({ id: uuid });

export const branchBillingQuerySchema = z.object({
  branchId: uuid.optional(),
  status: z.enum(["pending", "verified", "rejected"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

export const branchBillingPaymentSchema = z.object({
  branchId: uuid.optional(),
  settlementId: uuid.optional(),
  amount: z.coerce.number().positive().max(1_000_000_000),
  method: z.string().trim().min(1).max(100).optional(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

export const branchBillingReviewSchema = z.object({
  decision: z.enum(["verified", "rejected"]),
  remark: z.string().trim().max(500).optional(),
});

export type BranchTrackingQuery = z.infer<typeof branchTrackingQuerySchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type BranchSettlementQuery = z.infer<typeof branchSettlementQuerySchema>;
export type CreateBranchSettlementInput = z.infer<typeof createBranchSettlementSchema>;
export type PayBranchSettlementInput = z.infer<typeof payBranchSettlementSchema>;
