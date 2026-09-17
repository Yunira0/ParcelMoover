import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    vendors: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    vendor_payments: { aggregate: vi.fn() },
    vendor_staff: { findMany: vi.fn() },
    billing_settings: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    audit_logs: { create: vi.fn() },
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../notification.service", () => ({
  createNotification: vi.fn(),
}));

import {
  assertVendorCanCreateOrder,
  evaluateVendorBilling,
  getDefaultCreditLimit,
  getVendorAccountBalance,
  getVendorBillingStatus,
  resolveThresholds,
  stateForBalance,
  statusAffectsBalance,
  updateBillingSettings,
  updateVendorCreditLimit,
} from "../billing.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { createNotification } from "../notification.service";

const mockedPrisma = prisma as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
  vendors: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  vendor_payments: { aggregate: ReturnType<typeof vi.fn> };
  vendor_staff: { findMany: ReturnType<typeof vi.fn> };
  billing_settings: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};
const mockedRedis = redis as unknown as {
  get: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};
const mockedCreateNotification = createNotification as unknown as ReturnType<typeof vi.fn>;

// The four aggregate components, as the raw query returns them (DECIMAL columns
// come back as strings).
function mockBalanceRow(parts: {
  collected: number;
  charges: number;
  payouts: number;
  payments: number;
}) {
  mockedPrisma.$queryRaw.mockResolvedValue([
    {
      collected: String(parts.collected),
      charges: String(parts.charges),
      payouts: String(parts.payouts),
      payments: String(parts.payments),
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Caches off by default so each test exercises the real computation.
  mockedRedis.get.mockResolvedValue(null);
  mockedRedis.setex.mockResolvedValue("OK");
  mockedRedis.del.mockResolvedValue(1);
  mockedPrisma.billing_settings.findFirst.mockResolvedValue({
    id: "settings-1",
    warn_threshold: -2000,
    default_credit_limit: 3000,
    payment_qr_path: null,
    payment_note: null,
  });
  mockedPrisma.vendors.findFirst.mockResolvedValue({
    id: "vendor-1",
    user_id: "user-1",
    billing_warn_threshold: null,
    credit_limit: 3000,
    billing_alert_state: "ok",
  });
  mockedPrisma.vendor_payments.aggregate.mockResolvedValue({ _sum: { amount: null } });
  mockedPrisma.vendor_staff.findMany.mockResolvedValue([]);
  // The alert transition is a compare-and-swap; count 1 = this caller won it.
  mockedPrisma.vendors.updateMany.mockResolvedValue({ count: 1 });
});

describe("account balance", () => {
  it("nets to zero once a delivered COD parcel has been paid out", async () => {
    // COD 1000, charge 100, vendor already paid the 900 difference.
    mockBalanceRow({ collected: 1000, charges: 100, payouts: 900, payments: 0 });

    const balance = await getVendorAccountBalance("vendor-1", { skipCache: true });
    expect(balance.balance).toBe(0);
  });

  it("goes negative for a zero-COD parcel, which is pure delivery charge", async () => {
    mockBalanceRow({ collected: 0, charges: 150, payouts: 0, payments: 0 });

    const balance = await getVendorAccountBalance("vendor-1", { skipCache: true });
    expect(balance.balance).toBe(-150);
  });

  it("credits a verified payment back against the debt", async () => {
    mockBalanceRow({ collected: 0, charges: 150, payouts: 0, payments: 150 });

    const balance = await getVendorAccountBalance("vendor-1", { skipCache: true });
    expect(balance.balance).toBe(0);
  });

  it("subtracts payouts, or lifetime COD would show as a permanent credit", async () => {
    // The regression this guards: without the payouts term a long-standing
    // vendor looks permanently in credit and never trips a threshold.
    mockBalanceRow({ collected: 500000, charges: 40000, payouts: 460000, payments: 0 });

    const balance = await getVendorAccountBalance("vendor-1", { skipCache: true });
    expect(balance.balance).toBe(0);
  });

  it("rounds to paise so float dust can't drift a threshold comparison", async () => {
    mockBalanceRow({ collected: 0.1 + 0.2, charges: 0, payouts: 0, payments: 0 });

    const balance = await getVendorAccountBalance("vendor-1", { skipCache: true });
    expect(balance.balance).toBe(0.3);
  });
});

describe("threshold state", () => {
  const thresholds = { warnThreshold: -2000, blockThreshold: -3000 };

  it("is ok above the warn line", () => {
    expect(stateForBalance(-1999.99, thresholds)).toBe("ok");
  });

  it("warns exactly at the warn line", () => {
    expect(stateForBalance(-2000, thresholds)).toBe("warned");
  });

  it("stays warned between the two lines", () => {
    expect(stateForBalance(-2999.99, thresholds)).toBe("warned");
  });

  it("blocks exactly at the block line", () => {
    expect(stateForBalance(-3000, thresholds)).toBe("blocked");
  });

  it("blocks below the block line", () => {
    expect(stateForBalance(-5000, thresholds)).toBe("blocked");
  });

  it("prefers a per-vendor credit limit over the system default", async () => {
    mockedPrisma.vendors.findFirst.mockResolvedValue({
      id: "vendor-1",
      user_id: "user-1",
      billing_warn_threshold: -500,
      credit_limit: 800,
      billing_alert_state: "ok",
    });
    mockBalanceRow({ collected: 0, charges: 900, payouts: 0, payments: 0 });

    const status = await getVendorBillingStatus("vendor-1", { skipCache: true });
    expect(status.creditLimit).toBe(800);
    expect(status.blockThreshold).toBe(-800);
    expect(status.state).toBe("blocked");
  });

  it("reports what would clear the block", async () => {
    mockBalanceRow({ collected: 0, charges: 4270, payouts: 0, payments: 0 });

    const status = await getVendorBillingStatus("vendor-1", { skipCache: true });
    expect(status.balance).toBe(-4270);
    expect(status.amountToClearBlock).toBe(1270);
  });

  it("excludes unverified claims from the balance", async () => {
    mockBalanceRow({ collected: 0, charges: 4000, payouts: 0, payments: 0 });
    mockedPrisma.vendor_payments.aggregate.mockResolvedValue({ _sum: { amount: 4000 } });

    // A vendor must not be able to unblock themselves by filing a claim.
    const status = await getVendorBillingStatus("vendor-1", { skipCache: true });
    expect(status.balance).toBe(-4000);
    expect(status.state).toBe("blocked");
    expect(status.pendingPaymentAmount).toBe(4000);
  });
});

describe("order creation guard", () => {
  it("allows a vendor above the block threshold", async () => {
    mockBalanceRow({ collected: 0, charges: 2500, payouts: 0, payments: 0 });
    await expect(assertVendorCanCreateOrder("vendor-1")).resolves.toBeUndefined();
  });

  it("refuses a blocked vendor with the amount needed to resume", async () => {
    mockBalanceRow({ collected: 0, charges: 3500, payouts: 0, payments: 0 });

    await expect(assertVendorCanCreateOrder("vendor-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "VENDOR_BILLING_BLOCKED",
    });
  });
});

describe("alert state machine", () => {
  it("notifies once when a vendor first crosses into warned", async () => {
    mockBalanceRow({ collected: 0, charges: 2100, payouts: 0, payments: 0 });

    const state = await evaluateVendorBilling("vendor-1");
    expect(state).toBe("warned");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
  });

  it("stays silent while the state is unchanged", async () => {
    mockedPrisma.vendors.findFirst.mockResolvedValue({
      id: "vendor-1",
      user_id: "user-1",
      billing_warn_threshold: null,
      credit_limit: 3000,
      billing_alert_state: "warned",
    });
    mockBalanceRow({ collected: 0, charges: 2500, payouts: 0, payments: 0 });

    // Every delivery re-evaluates; only a crossing may notify.
    await evaluateVendorBilling("vendor-1");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
    expect(mockedPrisma.vendors.updateMany).not.toHaveBeenCalled();
  });

  it("stays silent when a concurrent evaluation already claimed the transition", async () => {
    // Two triggers can land at once (a bulk delivery while a settlement is
    // paid). The compare-and-swap matches zero rows for the loser, which must
    // then notify nobody - otherwise the vendor gets the same alert twice.
    mockedPrisma.vendors.updateMany.mockResolvedValue({ count: 0 });
    mockBalanceRow({ collected: 0, charges: 3500, payouts: 0, payments: 0 });

    const state = await evaluateVendorBilling("vendor-1");
    expect(state).toBe("blocked");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("notifies the owner and every enabled staff login", async () => {
    mockedPrisma.vendor_staff.findMany.mockResolvedValue([
      { user_id: "staff-1" },
      { user_id: "staff-2" },
    ]);
    mockBalanceRow({ collected: 0, charges: 3500, payouts: 0, payments: 0 });

    await evaluateVendorBilling("vendor-1");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(3);
  });

  it("tells a recovered vendor they are clear again", async () => {
    mockedPrisma.vendors.findFirst.mockResolvedValue({
      id: "vendor-1",
      user_id: "user-1",
      billing_warn_threshold: null,
      credit_limit: 3000,
      billing_alert_state: "blocked",
    });
    mockBalanceRow({ collected: 0, charges: 100, payouts: 0, payments: 0 });

    const state = await evaluateVendorBilling("vendor-1");
    expect(state).toBe("ok");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
  });

  it("swallows failures so a delivery is never blocked by billing", async () => {
    mockedPrisma.$queryRaw.mockRejectedValue(new Error("database is down"));

    await expect(evaluateVendorBilling("vendor-1")).resolves.toBeNull();
  });
});

describe("vendor-wise credit limits", () => {
  it("derives the block line from the vendor's own limit", () => {
    expect(resolveThresholds(
      { billing_warn_threshold: null, credit_limit: 50000 as never },
      { warnThreshold: -2000 },
    )).toEqual({ warnThreshold: -2000, blockThreshold: -50000 });
  });

  it("exposes the system default for creation-time assignment", async () => {
    await expect(getDefaultCreditLimit()).resolves.toBe(3000);
  });

  it("saves a new system default without touching any vendor row", async () => {
    await updateBillingSettings("admin-1", { defaultCreditLimit: 50000 });

    expect(mockedPrisma.billing_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ default_credit_limit: 50000 }) }),
    );
    expect(mockedPrisma.vendors.update).not.toHaveBeenCalled();
  });

  it("rejects a default that would block vendors before warning them", async () => {
    // Warn fires at -2000; a 1000 limit blocks at -1000 — harsher, so refused.
    await expect(updateBillingSettings("admin-1", { defaultCreditLimit: 1000 })).rejects.toThrow(
      "warned before being blocked",
    );
    expect(mockedPrisma.billing_settings.update).not.toHaveBeenCalled();
  });

  it("overrides one vendor, audits it, and re-evaluates them at once", async () => {
    // Every read in the flow (existence check, re-evaluation, final status)
    // sees the raised limit, as if reading after the committed update.
    mockedPrisma.vendors.findFirst.mockResolvedValue({
      id: "vendor-1",
      business_name: "Shop",
      client_name: "Owner",
      billing_warn_threshold: null,
      credit_limit: 100000,
      billing_alert_state: "ok",
    });
    const tx = {
      vendors: { update: vi.fn() },
      audit_logs: { create: vi.fn() },
    };
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    mockBalanceRow({ collected: 0, charges: 4270, payouts: 0, payments: 0 });

    const status = await updateVendorCreditLimit("admin-1", "vendor-1", 100000);

    expect(tx.vendors.update).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: { credit_limit: 100000 },
    });
    expect(tx.audit_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "UPDATE_VENDOR_CREDIT_LIMIT" }) }),
    );
    // 4270 owed against a 100000 limit: the raise unblocked them immediately.
    expect(status.creditLimit).toBe(100000);
    expect(status.state).toBe("warned");
  });

  it("rejects non-positive, non-numeric, and absurd limits", async () => {
    for (const limit of [0, -500, Number.NaN, 100_000_001]) {
      await expect(updateVendorCreditLimit("admin-1", "vendor-1", limit)).rejects.toThrow("creditLimit");
    }
    expect(mockedPrisma.vendors.update).not.toHaveBeenCalled();
  });

  it("404s for an unknown vendor", async () => {
    mockedPrisma.vendors.findFirst.mockResolvedValue(null);

    await expect(updateVendorCreditLimit("admin-1", "missing", 50000)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("balance-affecting statuses", () => {
  it("covers the statuses that earn or un-earn a charge", () => {
    expect(statusAffectsBalance("delivered")).toBe(true);
    expect(statusAffectsBalance("partially_delivered")).toBe(true);
    expect(statusAffectsBalance("returned_to_vendor")).toBe(true);
  });

  it("ignores mid-journey statuses that move no money", () => {
    expect(statusAffectsBalance("picked_up")).toBe(false);
    expect(statusAffectsBalance("sent_for_delivery")).toBe(false);
    expect(statusAffectsBalance(null)).toBe(false);
  });
});
