import { beforeEach, describe, expect, it, vi } from "vitest";

// The transition gate uses this pure classifier after it has calculated the
// branch's unsettled COD and verified credits. Keeping the edge rules covered
// here protects the threshold contract independently of database fixtures.
const mocks = vi.hoisted(() => ({
  adminFindUnique: vi.fn(),
  paymentCount: vi.fn(),
  paymentFindMany: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({ default: {
  admins: { findUnique: mocks.adminFindUnique },
  branch_payments: { count: mocks.paymentCount, findMany: mocks.paymentFindMany },
} }));
vi.mock("../billing.service", () => ({ getBillingSettings: vi.fn() }));

import { branchStateForBalance, listBranchPayments } from "../branch-billing.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.paymentCount.mockResolvedValue(0);
  mocks.paymentFindMany.mockResolvedValue([]);
});

describe("branchStateForBalance", () => {
  const thresholds = { warnThreshold: -50_000, blockThreshold: -75_000 };

  it("keeps a branch clear above its warning threshold", () => {
    expect(branchStateForBalance(-49_999.99, thresholds)).toBe("ok");
  });

  it("warns at the remittance warning threshold", () => {
    expect(branchStateForBalance(-50_000, thresholds)).toBe("warned");
  });

  it("blocks exactly at the transit block threshold", () => {
    expect(branchStateForBalance(-75_000, thresholds)).toBe("blocked");
  });
});

describe("listBranchPayments workspace direction", () => {
  it("shows the master workspace the cross-branch verification queue", async () => {
    mocks.adminFindUnique.mockResolvedValue({ location_id: "master-branch", branch_scoped: false });

    await listBranchPayments({ id: "master-admin", roles: ["admin"] }, { status: "pending" });

    expect(mocks.paymentCount).toHaveBeenCalledWith({ where: { status: "pending" } });
  });

  it("limits a paying branch workspace to its own submissions", async () => {
    mocks.adminFindUnique.mockResolvedValue({ location_id: "paying-branch", branch_scoped: true });

    await listBranchPayments({ id: "branch-admin", roles: ["admin"] }, { status: "pending" });

    expect(mocks.paymentCount).toHaveBeenCalledWith({
      where: { branch_id: "paying-branch", status: "pending" },
    });
  });
});
