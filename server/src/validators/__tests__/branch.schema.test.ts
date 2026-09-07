import { describe, expect, it } from "vitest";
import {
  branchTrackingQuerySchema,
  createBranchSchema,
  createBranchSettlementSchema,
  payBranchSettlementSchema,
} from "../branch.schema";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";

describe("branch tracking validation", () => {
  it("coerces pagination and preserves valid filters", () => {
    const result = branchTrackingQuerySchema.parse({
      fromBranchId: a, dateFrom: "2026-09-01", dateTo: "2026-09-06",
      metric: "pendingDeposit", page: "2", pageSize: "50",
    });
    expect(result).toMatchObject({ fromBranchId: a, metric: "pendingDeposit", page: 2, pageSize: 50 });
  });

  it("rejects an inverted date range and oversized pages", () => {
    expect(branchTrackingQuerySchema.safeParse({ dateFrom: "2026-09-06", dateTo: "2026-09-01" }).success).toBe(false);
    expect(branchTrackingQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it("dedicates branch commission and covered areas to one atomic request", () => {
    const result = createBranchSchema.parse({ locationId: a, coveredAreaIds: [b], commissionPerParcel: "50" });
    expect(result).toEqual({ locationId: a, coveredAreaIds: [b], virtualBranchIds: [], commissionPerParcel: 50 });
  });

  it("carries virtual branches through as their own array", () => {
    const result = createBranchSchema.parse({
      locationId: a, coveredAreaIds: [], virtualBranchIds: [b], commissionPerParcel: "0",
    });
    expect(result.virtualBranchIds).toEqual([b]);
  });

  it("rejects settlements whose paying and receiving branch are the same", () => {
    expect(createBranchSettlementSchema.safeParse({
      fromBranchId: a, toBranchId: a, settlementDate: "2026-09-06", orderIds: [b],
    }).success).toBe(false);
  });

  it("accepts a split branch payment and keeps money as numbers", () => {
    const result = payBranchSettlementSchema.parse({
      payments: [{ method: "Cash", amount: "1200.50" }, { method: "Bank", amount: 300 }],
      remark: "First remittance",
    });
    expect(result).toEqual({
      payments: [{ method: "Cash", amount: 1200.5 }, { method: "Bank", amount: 300 }],
      remark: "First remittance",
    });
  });

  it("does not allow a branch payment with no payment lines", () => {
    expect(payBranchSettlementSchema.safeParse({ payments: [] }).success).toBe(false);
  });
});
