import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({ default: {}, pool: {} }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() }, scanAndDelete: vi.fn() }));

import { ACCOUNT, CHART_OF_ACCOUNTS, clearAccountCache } from "../accounting/accounts";
import {
  hasEarnedDeliveryCharge,
  postCodCollected,
  postDeliveryChargeEarned,
  postOpeningBalance,
  postRiderRemittance,
  postVendorPaymentVerified,
  postVendorSettlement,
  SYNTHETIC_SOURCE_ID,
} from "../accounting/events";
import { wasPosted } from "../accounting/posting.service";

// Accounts generated alongside a payment method. Not in the chart - they are
// created when an admin adds the method - so the tests stand them up the same
// way the database does.
const PRABHU_BANK = "1100";
const ESEWA = "1101";

/** What loadMethodAccounts returns: lowercased method name -> account code. */
const METHOD_ACCOUNTS = new Map([
  ["bank transfer", PRABHU_BANK],
  ["esewa", ESEWA],
  ["fonepay", ESEWA],
]);

// The whole chart, so a mapping that reaches for an account the tests did not
// anticipate fails loudly instead of silently resolving to nothing.
const ACCOUNT_ROWS = [
  ...CHART_OF_ACCOUNTS.map((account) => ({
    id: `acct-${account.code}`,
    code: account.code,
    is_control: account.isControl ?? false,
    subledger_type: account.subledgerType ?? null,
    is_active: true,
  })),
  ...[PRABHU_BANK, ESEWA].map((code) => ({
    id: `acct-${code}`,
    code,
    is_control: false,
    subledger_type: null,
    is_active: true,
  })),
];

function fakeDb() {
  const db = {
    createdLines: [] as Array<Record<string, unknown>>,
    entryInserts: [] as unknown[],

    accounting_periods: { findUnique: vi.fn().mockResolvedValue({ status: "open" }) },
    ledger_accounts: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        ACCOUNT_ROWS.filter((row) => where.code.in.includes(row.code)),
      ),
    },
    journal_entries: {
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    journal_lines: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        db.createdLines.push(...data);
        return { count: data.length };
      }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      db.entryInserts.push(args);
      return [{ id: "entry-1", entry_no: "JE-2083-000001" }];
    }),
  };
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: ReturnType<typeof fakeDb>) => db as any;

/** The posted lines, keyed by account code, for readable assertions. */
function linesByAccount(db: ReturnType<typeof fakeDb>) {
  return db.createdLines.map((line) => ({
    code: String(line.account_id).replace("acct-", ""),
    debit: String(line.debit),
    credit: String(line.credit),
    party: line.party_id ? `${String(line.party_type)}:${String(line.party_id)}` : null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAccountCache();
});

// ── 1. COD collected ────────────────────────────────────────────────────────

describe("postCodCollected", () => {
  const collection = {
    id: "col-1",
    parcel_id: "parcel-1",
    vendor_id: "vendor-1",
    rider_id: "rider-1",
    collected_amount: 1000,
    collected_at: new Date("2026-08-07T06:00:00Z"),
    created_at: new Date("2026-08-01T06:00:00Z"),
  };

  it("moves cash to the rider and the obligation to the vendor", async () => {
    const db = fakeDb();
    const outcome = await postCodCollected(asDb(db), collection);

    expect(wasPosted(outcome)).toBe(true);
    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.CASH_WITH_RIDER, debit: "1000", credit: "0", party: "rider:rider-1" },
      { code: ACCOUNT.VENDOR_CONTROL, debit: "0", credit: "1000", party: "vendor:vendor-1" },
    ]);
  });

  it("books no revenue - COD is never the office's money", async () => {
    const db = fakeDb();
    await postCodCollected(asDb(db), collection);
    expect(linesByAccount(db).some((line) => line.code.startsWith("4"))).toBe(false);
  });

  it("skips a delivery where no cash was collected", async () => {
    const db = fakeDb();
    const outcome = await postCodCollected(asDb(db), { ...collection, collected_amount: 0 });
    expect(outcome).toEqual({ skipped: true, reason: "no cash collected" });
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("refuses to post without a rider, rather than losing the cash in a total", async () => {
    // Cash with Rider is a control account: an untagged line would sit in the
    // account total but in nobody's subledger.
    const db = fakeDb();
    await expect(postCodCollected(asDb(db), { ...collection, rider_id: null })).rejects.toThrow(/has no rider/);
  });

  it("refuses to post without a vendor, for the same reason as the rider", async () => {
    // 2000 Vendor is a control account too: the credit side has to name who the
    // money is owed to, and a collection with no vendor cannot.
    const db = fakeDb();
    await expect(postCodCollected(asDb(db), { ...collection, vendor_id: null })).rejects.toThrow(/has no vendor/);
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("falls back to created_at when the collection has no collected_at", async () => {
    const db = fakeDb();
    await postCodCollected(asDb(db), { ...collection, collected_at: null });
    expect(db.createdLines[0]!.entry_date).toEqual(collection.created_at);
  });
});

// ── 2. Delivery charge earned ───────────────────────────────────────────────

describe("hasEarnedDeliveryCharge", () => {
  it("earns on delivery and partial delivery", () => {
    expect(hasEarnedDeliveryCharge({ status: "delivered", order_type: "delivery" })).toBe(true);
    expect(hasEarnedDeliveryCharge({ status: "partially_delivered", order_type: "delivery" })).toBe(true);
  });

  it("earns on a return order that reached the vendor", () => {
    expect(hasEarnedDeliveryCharge({ status: "returned_to_vendor", order_type: "return" })).toBe(true);
  });

  it("does NOT earn on a plain RTO parcel", () => {
    // The row still carries its original outbound charge, so counting it would
    // bill the vendor a full delivery for a parcel that was never delivered.
    expect(hasEarnedDeliveryCharge({ status: "returned_to_vendor", order_type: "delivery" })).toBe(false);
  });

  it("does not earn before the parcel is delivered", () => {
    for (const status of ["sent_for_delivery", "dispatched", "hold", "failed_delivery", "cancelled"]) {
      expect(hasEarnedDeliveryCharge({ status, order_type: "delivery" })).toBe(false);
    }
  });
});

describe("postDeliveryChargeEarned", () => {
  const parcel = {
    id: "parcel-1",
    vendor_id: "vendor-1",
    tracking_id: "TRK00001",
    delivery_charge: 120,
    status: "delivered",
    order_type: "delivery",
    delivered_at: new Date("2026-08-07T06:00:00Z"),
    updated_at: new Date("2026-08-08T06:00:00Z"),
    destination_location_id: "loc-1",
  };

  it("takes the office's cut out of the vendor's position", async () => {
    const db = fakeDb();
    await postDeliveryChargeEarned(asDb(db), parcel);

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.VENDOR_CONTROL, debit: "120", credit: "0", party: "vendor:vendor-1" },
      { code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "120", party: null },
    ]);
  });

  it("books a return order to return revenue", async () => {
    const db = fakeDb();
    await postDeliveryChargeEarned(asDb(db), {
      ...parcel,
      order_type: "return",
      status: "returned_to_vendor",
      delivered_at: null,
    });

    expect(linesByAccount(db)[1]).toMatchObject({ code: ACCOUNT.RETURN_REVENUE, credit: "120" });
  });

  it("skips a plain RTO parcel", async () => {
    const db = fakeDb();
    const outcome = await postDeliveryChargeEarned(asDb(db), { ...parcel, status: "returned_to_vendor" });
    expect(outcome).toMatchObject({ skipped: true });
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("skips a zero-rated parcel", async () => {
    const db = fakeDb();
    const outcome = await postDeliveryChargeEarned(asDb(db), { ...parcel, delivery_charge: 0 });
    expect(outcome).toEqual({ skipped: true, reason: "no delivery charge" });
  });

  it("refuses to charge a vendor-less parcel", async () => {
    const db = fakeDb();
    await expect(postDeliveryChargeEarned(asDb(db), { ...parcel, vendor_id: null })).rejects.toThrow(
      /has no vendor/,
    );
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("tags the revenue line with the destination for branch reporting", async () => {
    const db = fakeDb();
    await postDeliveryChargeEarned(asDb(db), parcel);
    expect(db.createdLines[1]).toMatchObject({ location_id: "loc-1" });
  });
});

// ── 3. Rider remittance ─────────────────────────────────────────────────────

describe("postRiderRemittance", () => {
  const settlement = {
    id: "set-1",
    statement_id: "RS-001",
    payee_type: "rider",
    rider_id: "rider-1",
    vendor_id: null,
    amount: 1500,
    payable_amount: 1500,
    payment_method: "cash, eSewa",
    payments: [
      { method: "cash", amount: 1200 },
      { method: "eSewa", amount: 300 },
    ] as unknown as null,
    settlement_date: new Date("2026-08-07T00:00:00Z"),
    updated_at: new Date("2026-08-07T10:00:00Z"),
    methodAccounts: METHOD_ACCOUNTS,
  };

  it("splits the debit across the methods the money actually arrived in", async () => {
    const db = fakeDb();
    await postRiderRemittance(asDb(db), settlement);

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.CASH_IN_HAND, debit: "1200", credit: "0", party: null },
      { code: ESEWA, debit: "300", credit: "0", party: null },
      { code: ACCOUNT.CASH_WITH_RIDER, debit: "0", credit: "1500", party: "rider:rider-1" },
    ]);
  });

  it("moves nothing into revenue - both sides are the office's own assets", async () => {
    const db = fakeDb();
    await postRiderRemittance(asDb(db), settlement);
    expect(linesByAccount(db).some((line) => line.code.startsWith("4"))).toBe(false);
  });

  it("falls back to the header method when the breakdown does not add up", async () => {
    // A historical row written before payForSettlement validated the total.
    // Trusting it would post an unbalanced entry.
    const db = fakeDb();
    await postRiderRemittance(asDb(db), {
      ...settlement,
      payments: [{ method: "cash", amount: 900 }] as unknown as null,
      payment_method: "cash",
    });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.CASH_IN_HAND, debit: "1500", credit: "0", party: null },
      { code: ACCOUNT.CASH_WITH_RIDER, debit: "0", credit: "1500", party: "rider:rider-1" },
    ]);
  });

  it("falls back when there is no breakdown at all", async () => {
    const db = fakeDb();
    await postRiderRemittance(asDb(db), { ...settlement, payments: null, payment_method: "Bank Transfer" });
    expect(linesByAccount(db)[0]).toMatchObject({ code: PRABHU_BANK, debit: "1500" });
  });

  it("refuses a method with no account of its own", async () => {
    // No family fallback and no catch-all: an unrecognised method means the
    // books cannot say where the money went, so nothing is posted.
    const db = fakeDb();
    await expect(
      postRiderRemittance(asDb(db), { ...settlement, payments: null, payment_method: "crypto" }),
    ).rejects.toThrow(/has no ledger account/);
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("rejects a vendor statement passed to the rider mapping", async () => {
    const db = fakeDb();
    await expect(
      postRiderRemittance(asDb(db), { ...settlement, payee_type: "vendor", rider_id: null }),
    ).rejects.toThrow(/is not a rider statement/);
  });
});

// ── 4. Vendor settlement ────────────────────────────────────────────────────

describe("postVendorSettlement", () => {
  const base = {
    id: "set-2",
    statement_id: "VS-001",
    payee_type: "vendor",
    rider_id: null,
    vendor_id: "vendor-1",
    amount: 1500,
    payable_amount: 1320,
    payment_method: "Bank Transfer",
    payments: null,
    settlement_date: new Date("2026-08-07T00:00:00Z"),
    updated_at: new Date("2026-08-07T10:00:00Z"),
    methodAccounts: METHOD_ACCOUNTS,
  };

  it("pays the vendor when the payable is positive", async () => {
    const db = fakeDb();
    await postVendorSettlement(asDb(db), base);

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.VENDOR_CONTROL, debit: "1320", credit: "0", party: "vendor:vendor-1" },
      { code: PRABHU_BANK, debit: "0", credit: "1320", party: null },
    ]);
  });

  it("collects FROM the vendor when charges exceeded the COD", async () => {
    // payForSettlement models this direction explicitly; the ledger must
    // follow it rather than posting a negative payout.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, payable_amount: -150, payment_method: "cash" });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.CASH_IN_HAND, debit: "150", credit: "0", party: null },
      { code: ACCOUNT.VENDOR_CONTROL, debit: "0", credit: "150", party: "vendor:vendor-1" },
    ]);
  });

  it("skips a statement that nets to zero", async () => {
    const db = fakeDb();
    const outcome = await postVendorSettlement(asDb(db), { ...base, payable_amount: 0 });
    expect(outcome).toEqual({ skipped: true, reason: "payable nets to zero" });
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("falls back to the gross amount when payable_amount is null", async () => {
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, payable_amount: null });
    expect(linesByAccount(db)[0]).toMatchObject({ code: ACCOUNT.VENDOR_CONTROL, debit: "1500" });
  });
});

// ── 5. Vendor payment ───────────────────────────────────────────────────────

describe("postVendorPaymentVerified", () => {
  const payment = {
    id: "pay-1",
    vendor_id: "vendor-1",
    amount: 120,
    method: "fonepay",
    reference: "TXN-9",
    reviewed_at: new Date("2026-08-07T06:00:00Z"),
    created_at: new Date("2026-08-06T06:00:00Z"),
    methodAccounts: METHOD_ACCOUNTS,
  };

  it("takes the money in and reduces what the vendor owes", async () => {
    const db = fakeDb();
    await postVendorPaymentVerified(asDb(db), payment);

    expect(linesByAccount(db)).toEqual([
      { code: ESEWA, debit: "120", credit: "0", party: null },
      { code: ACCOUNT.VENDOR_CONTROL, debit: "0", credit: "120", party: "vendor:vendor-1" },
    ]);
  });

  it("refuses a payment whose method has no account", async () => {
    const db = fakeDb();
    await expect(
      postVendorPaymentVerified(asDb(db), { ...payment, method: "crypto" }),
    ).rejects.toThrow(/has no ledger account/);
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("books it on the day it was verified, not the day it was claimed", async () => {
    const db = fakeDb();
    await postVendorPaymentVerified(asDb(db), payment);
    expect(db.createdLines[0]!.entry_date).toEqual(payment.reviewed_at);
  });
});

// ── Opening balances ────────────────────────────────────────────────────────

describe("postOpeningBalance", () => {
  it("debits the account and credits equity for a positive opening", async () => {
    const db = fakeDb();
    await postOpeningBalance(asDb(db), {
      accountCode: ACCOUNT.CASH_IN_HAND,
      amount: 5000,
      asOf: new Date("2026-08-07T06:00:00Z"),
      reference: "counted cash",
    });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.CASH_IN_HAND, debit: "5000", credit: "0", party: null },
      { code: ACCOUNT.OPENING_BALANCE_EQUITY, debit: "0", credit: "5000", party: null },
    ]);
  });

  it("flips both sides for a negative opening", async () => {
    const db = fakeDb();
    await postOpeningBalance(asDb(db), {
      accountCode: ACCOUNT.CASH_IN_HAND,
      amount: -800,
      asOf: new Date("2026-08-07T06:00:00Z"),
      reference: "overdrawn float",
    });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.CASH_IN_HAND, debit: "0", credit: "800", party: null },
      { code: ACCOUNT.OPENING_BALANCE_EQUITY, debit: "800", credit: "0", party: null },
    ]);
  });

  it("uses a non-null source id so re-running cannot double the opening", async () => {
    // A NULL source_id would make every opening balance unique to itself in the
    // idempotency index, because Postgres treats NULLs there as distinct.
    const db = fakeDb();
    await postOpeningBalance(asDb(db), {
      accountCode: ACCOUNT.CASH_IN_HAND,
      amount: 5000,
      asOf: new Date("2026-08-07T06:00:00Z"),
      reference: "counted cash",
    });

    expect(db.journal_entries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_type: "opening_balance",
          source_id: SYNTHETIC_SOURCE_ID,
          event_key: `opening:${ACCOUNT.CASH_IN_HAND}:counted cash`,
        }),
      }),
    );
  });

  it("skips a zero opening balance", async () => {
    const db = fakeDb();
    const outcome = await postOpeningBalance(asDb(db), {
      accountCode: ACCOUNT.CASH_IN_HAND,
      amount: 0,
      asOf: new Date("2026-08-07T06:00:00Z"),
      reference: "nothing",
    });
    expect(outcome).toEqual({ skipped: true, reason: "zero opening balance" });
  });
});
