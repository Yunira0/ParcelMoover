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

export type BranchTrackingQuery = z.infer<typeof branchTrackingQuerySchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type BranchSettlementQuery = z.infer<typeof branchSettlementQuerySchema>;
export type CreateBranchSettlementInput = z.infer<typeof createBranchSettlementSchema>;
