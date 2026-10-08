import { beforeEach, describe, expect, it, vi } from "vitest";

// The transition gate uses this pure classifier after it has calculated the
// branch's unsettled COD and verified credits. Keeping the edge rules covered
// here protects the threshold contract independently of database fixtures.
const mocks = vi.hoisted(() => ({
  adminFindUnique: vi.fn(),
  paymentCount: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentAggregate: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  locationFindFirst: vi.fn(),
  locationFindUnique: vi.fn(),
  getBillingSettings: vi.fn(),
  // tx-scoped
  txPaymentUpdateMany: vi.fn(),
  txPaymentUpdate: vi.fn(),
  txPaymentCreate: vi.fn(),
  txPaymentFindFirstOrThrow: vi.fn(),
  txSettlementFindUnique: vi.fn(),
  txSettlementFindMany: vi.fn(),
  txSettlementUpdate: vi.fn(),
  txSettlementPaymentCreate: vi.fn(),
  txAuditCreate: vi.fn(),
  syncBranchSettlementPostings: vi.fn(),
  methodFindFirst: vi.fn(),
  entryFindMany: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({ default: {
  admins: { findUnique: mocks.adminFindUnique },
  branch_payments: {
    count: mocks.paymentCount, findMany: mocks.paymentFindMany,
    findFirst: mocks.paymentFindFirst, aggregate: mocks.paymentAggregate,
  },
  locations: { findFirst: mocks.locationFindFirst, findUnique: mocks.locationFindUnique },
  payment_methods: { findFirst: mocks.methodFindFirst },
  journal_entries: { findMany: mocks.entryFindMany },
  $queryRaw: mocks.queryRaw,
  $transaction: mocks.transaction,
} }));
vi.mock("../billing.service", () => ({ getBillingSettings: mocks.getBillingSettings }));
vi.mock("../accounting/sync", () => ({ syncBranchSettlementPostings: mocks.syncBranchSettlementPostings }));

import { branchStateForBalance, listBranchPayments, receiveBranchCod, reviewBranchPayment } from "../branch-billing.service";

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

describe("reviewBranchPayment — verifying an Add money deposit", () => {
  const superAdmin = { id: "office-1", roles: ["super_admin"] };

  const wireTransaction = () => {
    const tx = {
      branch_payments: {
        updateMany: mocks.txPaymentUpdateMany,
        update: mocks.txPaymentUpdate,
        create: mocks.txPaymentCreate,
        findFirstOrThrow: mocks.txPaymentFindFirstOrThrow,
      },
      branch_settlements: {
        findUnique: mocks.txSettlementFindUnique,
        findMany: mocks.txSettlementFindMany,
        update: mocks.txSettlementUpdate,
      },
      branch_settlement_payments: { create: mocks.txSettlementPaymentCreate },
      audit_logs: { create: mocks.txAuditCreate },
    };
    mocks.transaction.mockImplementation(async (cb: (client: unknown) => Promise<unknown>) => cb(tx));
    mocks.txPaymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txSettlementPaymentCreate.mockResolvedValue({});
    mocks.txSettlementUpdate.mockResolvedValue({});
    mocks.txPaymentUpdate.mockResolvedValue({});
    mocks.txPaymentCreate.mockResolvedValue({});
    mocks.txAuditCreate.mockResolvedValue({});
    mocks.txPaymentFindFirstOrThrow.mockResolvedValue({
      id: "pay-1", branch_id: "branch-a", branch: { name: "Branch A" }, amount: 0,
      method: "fonepay", settlement_id: null, settlement: null, reference: null,
      proof_path: "uploads/x.png", status: "verified", note: null,
      review_remark: null, reviewed_at: new Date(), created_at: new Date(),
    });
    // evaluateBranchBilling runs after the tx (best-effort); wire enough for it
    // to resolve cleanly rather than swallow a thrown DB error.
    mocks.getBillingSettings.mockResolvedValue({
      warnThreshold: -2000,
      blockThreshold: -3000,
      branchWarnThreshold: -50000,
      branchBlockThreshold: -75000,
    });
    mocks.locationFindFirst.mockResolvedValue({
      id: "branch-a", name: "Branch A",
      branch_billing_warn_threshold: null, branch_billing_block_threshold: null,
    });
    mocks.locationFindUnique.mockResolvedValue({ branch_billing_alert_state: "ok" });
    mocks.queryRaw.mockResolvedValue([{ outstanding: "0", unstatemented: "0", payments: "0" }]);
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  };

  const pendingDeposit = (amount: number) => ({
    id: "pay-1", branch_id: "branch-a", settlement_id: null, amount, method: "fonepay",
    reference: "TXN-9", proof_path: "uploads/x.png", note: null, submitted_by: "branch-user",
    status: "pending", branch: { name: "Branch A" }, settlement: null,
  });

  const openStatement = (id: string, netPayable: number, paidAmount = 0) => ({
    id, statement_no: id.toUpperCase(), net_payable: netPayable, paid_amount: paidAmount,
    payments: null, status: "pending", from_branch_id: "branch-a",
  });

  it("settles a statement the deposit covers exactly", async () => {
    wireTransaction();
    mocks.paymentFindFirst.mockResolvedValue(pendingDeposit(5000));
    mocks.txSettlementFindMany.mockResolvedValue([openStatement("s1", 5000)]);

    await reviewBranchPayment(superAdmin, "pay-1", "verified");

    expect(mocks.txSettlementUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "s1" },
      data: expect.objectContaining({ paid_amount: 5000, status: "settled", settled_by: "office-1" }),
    }));
    // Whole deposit consumed -> the receipt is re-pointed at the statement.
    expect(mocks.txPaymentUpdate).toHaveBeenCalledWith({ where: { id: "pay-1" }, data: { settlement_id: "s1" } });
    expect(mocks.txPaymentCreate).not.toHaveBeenCalled();
  });

  it("marks a statement partially_paid when the deposit is short", async () => {
    wireTransaction();
    mocks.paymentFindFirst.mockResolvedValue(pendingDeposit(3000));
    mocks.txSettlementFindMany.mockResolvedValue([openStatement("s1", 5000)]);

    await reviewBranchPayment(superAdmin, "pay-1", "verified");

    expect(mocks.txSettlementUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "s1" },
      data: expect.objectContaining({ paid_amount: 3000, status: "partially_paid" }),
    }));
    // A short deposit must not stamp the statement as settled.
    expect(mocks.txSettlementUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ settled_by: expect.anything() }),
    }));
    // The part payment still moves the books, inside the same transaction.
    expect(mocks.syncBranchSettlementPostings).toHaveBeenCalledWith(
      expect.anything(), ["s1"], expect.objectContaining({ actorId: "office-1" }),
    );
  });

  it("waterfalls oldest-first and keeps the remainder as branch credit", async () => {
    wireTransaction();
    mocks.paymentFindFirst.mockResolvedValue(pendingDeposit(12_000));
    mocks.txSettlementFindMany.mockResolvedValue([
      openStatement("s1", 5000),
      openStatement("s2", 4000),
    ]);

    await reviewBranchPayment(superAdmin, "pay-1", "verified");

    expect(mocks.txSettlementUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "s1" }, data: expect.objectContaining({ status: "settled", paid_amount: 5000 }),
    }));
    expect(mocks.txSettlementUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "s2" }, data: expect.objectContaining({ status: "settled", paid_amount: 4000 }),
    }));
    // 3000 left over: the row keeps the remainder, the applied 9000 is hived
    // into a linked child receipt so the branch balance still nets out.
    expect(mocks.txPaymentUpdate).toHaveBeenCalledWith({ where: { id: "pay-1" }, data: { amount: 3000 } });
    expect(mocks.txPaymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ settlement_id: "s1", amount: 9000, status: "verified", branch_id: "branch-a" }),
    }));
  });

  it("leaves the deposit as pure credit when the branch has no open statements", async () => {
    wireTransaction();
    mocks.paymentFindFirst.mockResolvedValue(pendingDeposit(5000));
    mocks.txSettlementFindMany.mockResolvedValue([]);

    await reviewBranchPayment(superAdmin, "pay-1", "verified");

    expect(mocks.txSettlementUpdate).not.toHaveBeenCalled();
    expect(mocks.txPaymentUpdate).not.toHaveBeenCalled();
    expect(mocks.txPaymentCreate).not.toHaveBeenCalled();
  });
});

describe("receiveBranchCod — cash from a branch on a Receipt voucher", () => {
  const accountant = { id: "acct-1", roles: ["accountant"] };
  const statement = (id: string, netPayable: number, paidAmount = 0) => ({
    id, statement_no: id.toUpperCase(), net_payable: netPayable, paid_amount: paidAmount,
    payments: null, status: paidAmount > 0 ? "partially_paid" : "pending", from_branch_id: "branch-a",
  });

  const wire = (statements: ReturnType<typeof statement>[]) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      branch_settlements: { findMany: mocks.txSettlementFindMany, update: mocks.txSettlementUpdate },
      branch_settlement_payments: { create: mocks.txSettlementPaymentCreate },
      audit_logs: { create: mocks.txAuditCreate },
    };
    mocks.transaction.mockImplementation(async (cb: (client: unknown) => Promise<unknown>) => cb(tx));
    mocks.txSettlementFindMany.mockResolvedValue(statements);
    mocks.txSettlementPaymentCreate.mockResolvedValue({});
    mocks.txSettlementUpdate.mockResolvedValue({});
    mocks.txAuditCreate.mockResolvedValue({});
    mocks.methodFindFirst.mockResolvedValue({ name: "Cash" });
    mocks.entryFindMany.mockResolvedValue([{ id: "je-1", entry_no: "JV-1" }]);
    // evaluateBranchBilling afterwards: an inactive branch makes it a no-op.
    mocks.locationFindFirst.mockResolvedValue(null);
  };

  it("pays open statements down oldest first in the chosen account's method", async () => {
    wire([statement("s1", 5000), statement("s2", 4000)]);

    const result = await receiveBranchCod(accountant, { branchId: "branch-a", amount: 7000, accountCode: "1000" });

    expect(mocks.txSettlementUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "s1" }, data: expect.objectContaining({ paid_amount: 5000, status: "settled", payment_method: "Cash" }),
    }));
    expect(mocks.txSettlementUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "s2" }, data: expect.objectContaining({ paid_amount: 2000, status: "partially_paid" }),
    }));
    expect(mocks.syncBranchSettlementPostings).toHaveBeenCalledTimes(2);
    expect(result.allocations.map((a) => a.amount)).toEqual([5000, 2000]);
    expect(result.entries).toEqual([{ id: "je-1", entryNo: "JV-1" }]);
  });

  it("refuses more than the branch owes, so no cash goes unposted", async () => {
    wire([statement("s1", 5000, 1000)]);

    await expect(receiveBranchCod(accountant, { branchId: "branch-a", amount: 4500, accountCode: "1000" }))
      .rejects.toThrow("more than the Rs. 4000");
    expect(mocks.txSettlementUpdate).not.toHaveBeenCalled();
  });

  it("refuses a branch with no open statements", async () => {
    wire([]);

    await expect(receiveBranchCod(accountant, { branchId: "branch-a", amount: 100, accountCode: "1000" }))
      .rejects.toThrow("no open COD statements");
  });

  it("refuses an account no payment method routes to", async () => {
    wire([statement("s1", 5000)]);
    mocks.methodFindFirst.mockResolvedValue(null);

    await expect(receiveBranchCod(accountant, { branchId: "branch-a", amount: 100, accountCode: "1105" }))
      .rejects.toThrow("no active payment method");
  });

  it("is limited to office finance authority", async () => {
    await expect(receiveBranchCod({ id: "admin-1", roles: ["admin"] }, { branchId: "branch-a", amount: 100, accountCode: "1000" }))
      .rejects.toThrow("super admin or accountant");
  });
});
