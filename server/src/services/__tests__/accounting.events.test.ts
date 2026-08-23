import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({ default: {}, pool: {} }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() }, scanAndDelete: vi.fn() }));

import { ACCOUNT, CHART_OF_ACCOUNTS, clearAccountCache } from "../accounting/accounts";
import {
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

// Parcels post nothing. There is deliberately no suite here for COD collected
// or delivery charge earned: a parcel is not a money event in this ledger, and
// the statement that settles it carries the whole cycle instead. What a vendor
// is owed before that point lives in billing.service, and is tested there.

// ── 1. Rider remits to the office ───────────────────────────────────────────

describe("postRiderRemittance", () => {
  const settlement = {
    id: "set-1",
    statement_id: "RS-001",
    payee_type: "rider",
    rider_id: "rider-1",
    vendor_id: null,
    amount: 1500,
    payable_amount: 1500,
    paid_amount: 1500,
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
      { code: ACCOUNT.COD_HELD, debit: "0", credit: "1500", party: "rider:rider-1" },
    ]);
  });

  it("moves nothing into revenue - the office is only holding this money", async () => {
    // None of a remittance is the office's to keep. The cut is recognised on
    // the vendor statement that releases the COD, not on the way in.
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
      { code: ACCOUNT.COD_HELD, debit: "0", credit: "1500", party: "rider:rider-1" },
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
    paid_amount: 1320,
    payment_method: "Bank Transfer",
    payments: null,
    settlement_date: new Date("2026-08-07T00:00:00Z"),
    updated_at: new Date("2026-08-07T10:00:00Z"),
    methodAccounts: METHOD_ACCOUNTS,
  };

  it("posts the whole cycle: COD released, cut earned, remainder paid out", async () => {
    // The one entry that carries the money. Nothing was posted while these
    // parcels were being delivered, so the gross COD comes off the float the
    // rider remittances built up rather than netting against a running balance.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), base);

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.COD_HELD, debit: "1500", credit: "0", party: "vendor:vendor-1" },
      { code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "180", party: null },
      { code: PRABHU_BANK, debit: "0", credit: "1320", party: null },
    ]);
  });

  it("books the office's cut as revenue, and only the cut", async () => {
    // 1500 collected, 1320 paid out: the office keeps 180 and not a rupee more.
    // Getting this wrong in either direction turns other people's money into
    // income, which is the one mistake this ledger exists to prevent.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), base);

    const revenue = linesByAccount(db).filter((line) => line.code.startsWith("4"));
    expect(revenue).toEqual([{ code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "180", party: null }]);
  });

  it("splits the cut between delivery and return revenue", async () => {
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, return_charges: 50 });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.COD_HELD, debit: "1500", credit: "0", party: "vendor:vendor-1" },
      { code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "130", party: null },
      { code: ACCOUNT.RETURN_REVENUE, debit: "0", credit: "50", party: null },
      { code: PRABHU_BANK, debit: "0", credit: "1320", party: null },
    ]);
  });

  it("clamps a return share that exceeds the statement's own cut", async () => {
    // The split is advisory - derived from parcels that may have been edited
    // since. The total is not. A stale share must move which revenue account a
    // rupee lands in, never whether the entry balances.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, return_charges: 9999 });

    const revenue = linesByAccount(db).filter((line) => line.code.startsWith("4"));
    expect(revenue).toEqual([{ code: ACCOUNT.RETURN_REVENUE, debit: "0", credit: "180", party: null }]);
  });

  it("collects FROM the vendor when charges exceeded the COD", async () => {
    // payForSettlement models this direction explicitly; the ledger must
    // follow it rather than posting a negative payout. The cut is still 1650
    // here - the vendor pays the 150 the COD could not cover.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, payable_amount: -150, payment_method: "cash" });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.COD_HELD, debit: "1500", credit: "0", party: "vendor:vendor-1" },
      { code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "1650", party: null },
      { code: ACCOUNT.CASH_IN_HAND, debit: "150", credit: "0", party: null },
    ]);
  });

  it("posts a statement whose COD exactly covered its charges", async () => {
    // No cash moves, but 1500 of COD stopped being owed and 1500 of revenue
    // was earned. Skipping it would leave the float overstated forever.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, payable_amount: 0 });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.COD_HELD, debit: "1500", credit: "0", party: "vendor:vendor-1" },
      { code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "1500", party: null },
    ]);
  });

  it("skips a statement that moves no money at all", async () => {
    const db = fakeDb();
    const outcome = await postVendorSettlement(asDb(db), { ...base, amount: 0, payable_amount: 0 });
    expect(outcome).toEqual({ skipped: true, reason: "statement moves no money" });
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("falls back to the gross amount when payable_amount is null", async () => {
    // Payable null means "nothing withheld", so the whole gross is owed out and
    // there is no revenue line at all. 1320 of it has been paid; the last 180
    // is still a debt to the vendor.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, payable_amount: null });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.COD_HELD, debit: "1500", credit: "0", party: "vendor:vendor-1" },
      { code: PRABHU_BANK, debit: "0", credit: "1320", party: null },
      { code: ACCOUNT.VENDOR_CONTROL, debit: "0", credit: "180", party: "vendor:vendor-1" },
    ]);
  });

  it("owes the whole payout when nothing has been paid yet", async () => {
    // A statement the moment it is created: no cash has moved and it has no
    // payment method to move it through. The payout is a debt, and posting it
    // as one is what lets the entry exist at creation time at all.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, paid_amount: 0, payment_method: null });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.COD_HELD, debit: "1500", credit: "0", party: "vendor:vendor-1" },
      { code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "180", party: null },
      { code: ACCOUNT.VENDOR_CONTROL, debit: "0", credit: "1320", party: "vendor:vendor-1" },
    ]);
  });

  it("splits the payout across cash paid and cash still owed", async () => {
    // A part-paid statement. Under the old gate this posted nothing at all
    // until the final instalment landed, so real cash sat outside the books.
    const db = fakeDb();
    await postVendorSettlement(asDb(db), { ...base, paid_amount: 500 });

    expect(linesByAccount(db)).toEqual([
      { code: ACCOUNT.COD_HELD, debit: "1500", credit: "0", party: "vendor:vendor-1" },
      { code: ACCOUNT.DELIVERY_REVENUE, debit: "0", credit: "180", party: null },
      { code: PRABHU_BANK, debit: "0", credit: "500", party: null },
      { code: ACCOUNT.VENDOR_CONTROL, debit: "0", credit: "820", party: "vendor:vendor-1" },
    ]);
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
