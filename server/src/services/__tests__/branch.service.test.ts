// resolveBranchLocationIds is the one place "what counts as covered by
// branch X" gets decided - transit manifest destination checks, branch
// settlement eligibility, and branch orders/overview rollups all go through
// it. These lock down the virtual-coverage expansion added alongside it:
// a virtually-covered branch contributes itself and its own plain covered
// areas, one level only, without needing (or recursing into) its own
// virtual list.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "../../generated/prisma/client";

const { transaction, createNotificationMock } = vi.hoisted(() => ({
  transaction: vi.fn(),
  createNotificationMock: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({
  default: {
    locations: { findFirst: vi.fn(), findUnique: vi.fn() },
    admins: { findMany: vi.fn() },
    branch_settlements: { findUnique: vi.fn() },
    $transaction: transaction,
  },
}));
vi.mock("../order.service", () => ({ listOrders: vi.fn() }));
vi.mock("../pricing.service", () => ({ invalidateDestinationPricingCache: vi.fn() }));
vi.mock("../notification.service", () => ({ createNotification: createNotificationMock }));
// createBranchSettlement refreshes the paying branch's credit state after a
// statement is cut; that path has its own DB fixtures and coverage elsewhere.
vi.mock("../branch-billing.service", () => ({ evaluateBranchBilling: vi.fn() }));

import prisma from "../../lib/prisma";
import { createBranchSettlement, getBranchSettlementDetail, resolveBranchLocationIds } from "../branch.service";

const mockedFindFirst = (prisma as unknown as { locations: { findFirst: ReturnType<typeof vi.fn> } })
  .locations.findFirst;
const mockedSettlementFindUnique = (prisma as unknown as {
  branch_settlements: { findUnique: ReturnType<typeof vi.fn> };
}).branch_settlements.findUnique;
const mockedLocationFindUnique = (prisma as unknown as {
  locations: { findUnique: ReturnType<typeof vi.fn> };
}).locations.findUnique;
const mockedAdminFindMany = (prisma as unknown as {
  admins: { findMany: ReturnType<typeof vi.fn> };
}).admins.findMany;

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdminFindMany.mockResolvedValue([]);
});

describe("resolveBranchLocationIds", () => {
  it("returns just the branch when it covers nothing", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "branch-a", other_locations: [], branch_virtual_coverage_branch: [],
    });

    expect(await resolveBranchLocationIds("branch-a")).toEqual(["branch-a"]);
  });

  it("folds in a virtually-covered branch's own id and its own covered areas", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "branch-a",
      other_locations: [{ id: "area-1" }],
      branch_virtual_coverage_branch: [
        {
          covered_branch: {
            id: "branch-b",
            other_locations: [{ id: "area-2" }, { id: "area-3" }],
          },
        },
      ],
    });

    expect(await resolveBranchLocationIds("branch-a")).toEqual([
      "branch-a", "area-1", "branch-b", "area-2", "area-3",
    ]);
  });

  it("404s when the branch doesn't exist or isn't an active hub", async () => {
    mockedFindFirst.mockResolvedValue(null);

    await expect(resolveBranchLocationIds("branch-x")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns undefined for no branch at all - nothing to scope by", async () => {
    expect(await resolveBranchLocationIds(undefined)).toBeUndefined();
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });
});

describe("getBranchSettlementDetail", () => {
  it("returns only the verified payment proofs selected by the statement query", async () => {
    mockedSettlementFindUnique.mockResolvedValue({
      id: "settlement-1",
      statement_no: "BRS-20830501-TEST",
      from_branch_id: "branch-a",
      to_branch_id: "branch-b",
      settlement_date: new Date("2026-08-17T00:00:00.000Z"),
      status: "settled",
      gross_cod: 1_100,
      commission_per_parcel: 100,
      commission_amount: 100,
      net_payable: 1_000,
      paid_amount: 1_000,
      payment_method: null,
      payments: null,
      remark: null,
      settled_at: new Date("2026-08-18T04:00:00.000Z"),
      created_at: new Date("2026-08-17T04:00:00.000Z"),
      from_branch: { id: "branch-a", name: "Amardaha" },
      to_branch: { id: "branch-b", name: "Morang" },
      settled_by_user: { full_name: "Office Admin" },
      payment_records: [],
      payment_claims: [{
        id: "claim-1",
        amount: 1_000,
        method: "Fonepay",
        reference: "TXN-100",
        proof_path: "uploads/billing/receipt.png",
        note: "Full COD payment",
        reviewed_at: new Date("2026-08-18T04:00:00.000Z"),
        created_at: new Date("2026-08-18T03:00:00.000Z"),
      }],
      items: [],
    });

    const detail = await getBranchSettlementDetail(
      { id: "office-admin", roles: ["super_admin"] } as any,
      "settlement-1",
    );

    expect(mockedSettlementFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        payment_claims: expect.objectContaining({
          where: { status: "verified", proof_path: { not: null } },
        }),
      }),
    }));
    expect(detail.paymentProofs).toEqual([{
      id: "claim-1",
      amount: 1_000,
      method: "Fonepay",
      reference: "TXN-100",
      proofPath: "uploads/billing/receipt.png",
      note: "Full COD payment",
      submittedAt: "2026-08-18T03:00:00.000Z",
      verifiedAt: "2026-08-18T04:00:00.000Z",
    }]);
  });
});

describe("createBranchSettlement", () => {
  it("selects orders delivered by the paying branch, not orders routed between payer and master", async () => {
    mockedFindFirst
      .mockResolvedValueOnce({ id: "master-branch", name: "Imadol" })
      .mockResolvedValueOnce({ id: "paying-branch", other_locations: [{ id: "paying-area" }], branch_virtual_coverage_branch: [] });
    mockedLocationFindUnique.mockResolvedValue({ commission_per_parcel: new Prisma.Decimal(50) });

    const parcelFindMany = vi.fn().mockResolvedValue([{
      id: "parcel-1",
      cod_amount: new Prisma.Decimal(1_000),
      cod_collections: { collected_amount: new Prisma.Decimal(1_000) },
    }]);
    transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback({
      parcels: { findMany: parcelFindMany },
      branch_settlements: { create: vi.fn().mockResolvedValue({ id: "statement-1", status: "pending" }) },
      audit_logs: { create: vi.fn().mockResolvedValue({}) },
    }));

    await createBranchSettlement(
      { id: "office-admin", roles: ["super_admin"] } as any,
      {
        fromBranchId: "paying-branch",
        toBranchId: "master-branch",
        settlementDate: "2026-09-07",
        orderIds: ["parcel-1"],
      },
    );

    const call = parcelFindMany.mock.calls[0];
    expect(call).toBeDefined();
    const where = call![0].where;
    expect(where.destination_location_id).toEqual({ in: ["paying-branch", "paying-area"] });
    expect(where).not.toHaveProperty("origin_location_id");
  });

  it("notifies active admins in the paying branch with a link to attach proof", async () => {
    mockedFindFirst
      .mockResolvedValueOnce({ id: "master-branch", name: "Imadol" })
      .mockResolvedValueOnce({ id: "paying-branch", other_locations: [], branch_virtual_coverage_branch: [] });
    mockedLocationFindUnique.mockResolvedValue({ commission_per_parcel: new Prisma.Decimal(50) });
    mockedAdminFindMany.mockResolvedValue([{ user_id: "paying-admin" }]);
    transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback({
      parcels: { findMany: vi.fn().mockResolvedValue([{
        id: "parcel-1",
        cod_amount: new Prisma.Decimal(1_000),
        cod_collections: { collected_amount: new Prisma.Decimal(1_000) },
      }]) },
      branch_settlements: { create: vi.fn().mockResolvedValue({ id: "statement-1", status: "pending" }) },
      audit_logs: { create: vi.fn().mockResolvedValue({}) },
    }));

    await createBranchSettlement(
      { id: "office-admin", roles: ["super_admin"] } as any,
      {
        fromBranchId: "paying-branch",
        toBranchId: "master-branch",
        settlementDate: "2026-09-07",
        orderIds: ["parcel-1"],
      },
    );

    expect(mockedAdminFindMany).toHaveBeenCalledWith({
      where: {
        location_id: "paying-branch",
        branch_scoped: true,
        users: { is: { status: "active", deleted_at: null } },
      },
      select: { user_id: true },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      "paying-admin",
      expect.stringContaining("Branch statement BRS-"),
      "Pay Rs. 950 to Imadol for 1 delivered order, then attach the payment proof.",
      "statement-1",
      "branch_settlement",
      "/branches/billing?tab=statements",
    );
  });

  it("rejects any receiving branch other than Imadol", async () => {
    mockedFindFirst.mockResolvedValueOnce({ id: "imadol-branch", name: "Imadol" });

    await expect(createBranchSettlement(
      { id: "office-admin", roles: ["super_admin"] } as any,
      {
        fromBranchId: "paying-branch",
        toBranchId: "another-branch",
        settlementDate: "2026-09-07",
        orderIds: ["parcel-1"],
      },
    )).rejects.toMatchObject({
      statusCode: 400,
      message: "The receiving master branch must be Imadol",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
