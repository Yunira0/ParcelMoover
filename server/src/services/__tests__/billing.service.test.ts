import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
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
  getVendorAccountBalance,
  getVendorBillingStatus,
  stateForBalance,
  statusAffectsBalance,
} from "../billing.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { createNotification } from "../notification.service";

const mockedPrisma = prisma as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  vendors: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  vendor_payments: { aggregate: ReturnType<typeof vi.fn> };
  vendor_staff: { findMany: ReturnType<typeof vi.fn> };
  billing_settings: { findFirst: ReturnType<typeof vi.fn> };
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
    block_threshold: -3000,
    payment_qr_path: null,
    payment_note: null,
  });
  mockedPrisma.vendors.findFirst.mockResolvedValue({
    id: "vendor-1",
    user_id: "user-1",
    billing_warn_threshold: null,
    billing_block_threshold: null,
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

  it("prefers a per-vendor override over the global threshold", async () => {
    mockedPrisma.vendors.findFirst.mockResolvedValue({
      id: "vendor-1",
      user_id: "user-1",
      billing_warn_threshold: -500,
      billing_block_threshold: -800,
      billing_alert_state: "ok",
    });
    mockBalanceRow({ collected: 0, charges: 900, payouts: 0, payments: 0 });

    const status = await getVendorBillingStatus("vendor-1", { skipCache: true });
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
      billing_block_threshold: null,
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
      billing_block_threshold: null,
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
