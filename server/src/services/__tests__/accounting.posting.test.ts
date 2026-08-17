import { describe, it, expect, vi, beforeEach } from "vitest";

// posting.service and accounts both import the shared Prisma client for its
// type and as a default `db`. Neither is used in these tests - every call takes
// an explicit fake client - but the import itself would open a connection pool.
vi.mock("../../lib/prisma", () => ({ default: {}, pool: {} }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() }, scanAndDelete: vi.fn() }));

import { Prisma } from "../../generated/prisma/client";
import { ACCOUNT, cashAccountForMethod, clearAccountCache } from "../accounting/accounts";
import { postJournal, reverseJournal, wasPosted, type PostOutcome } from "../accounting/posting.service";

// ── Fake transaction client ─────────────────────────────────────────────────
//
// Hand-built rather than a mocked module, because the interesting behaviour is
// what postJournal *writes* - so the test needs to read back the rows it built.

const ACCOUNT_ROWS = [
  { id: "acct-cash", code: ACCOUNT.CASH_IN_HAND, is_control: false, subledger_type: null, is_active: true },
  // An account generated alongside a payment method, not one from the chart.
  { id: "acct-wallet", code: "1101", is_control: false, subledger_type: null, is_active: true },
  { id: "acct-rider", code: ACCOUNT.CASH_WITH_RIDER, is_control: true, subledger_type: "rider", is_active: true },
  { id: "acct-vendor", code: ACCOUNT.VENDOR_CONTROL, is_control: true, subledger_type: "vendor", is_active: true },
  { id: "acct-revenue", code: ACCOUNT.DELIVERY_REVENUE, is_control: false, subledger_type: null, is_active: true },
  { id: "acct-equity", code: ACCOUNT.OPENING_BALANCE_EQUITY, is_control: false, subledger_type: null, is_active: true },
];

interface FakeOptions {
  periodStatus?: "open" | "closed" | "missing";
  existingEntry?: { id: string; entry_no: string; period_key: string } | null;
  insertReturns?: Array<{ id: string; entry_no: string }>;
}

function fakeDb(options: FakeOptions = {}) {
  const { periodStatus = "open", existingEntry = null, insertReturns = [{ id: "entry-1", entry_no: "JE-2083-000001" }] } =
    options;

  const period = periodStatus === "missing" ? null : { status: periodStatus };

  const db = {
    createdLines: [] as Array<Record<string, unknown>>,

    accounting_periods: {
      // First call answers "does it exist"; after an insert it always exists.
      findUnique: vi.fn().mockResolvedValue(period ?? { status: "open" }),
    },
    ledger_accounts: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        ACCOUNT_ROWS.filter((row) => where.code.in.includes(row.code)),
      ),
    },
    journal_entries: {
      findFirst: vi.fn().mockResolvedValue(existingEntry),
      findFirstOrThrow: vi.fn().mockResolvedValue(existingEntry ?? { id: "entry-x", entry_no: "JE-x", period_key: "2083-04" }),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    journal_lines: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        db.createdLines.push(...data);
        return { count: data.length };
      }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(insertReturns),
  };

  if (periodStatus === "missing") {
    db.accounting_periods.findUnique.mockResolvedValueOnce(null);
  }

  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: ReturnType<typeof fakeDb>) => db as any;

const ENTRY_DATE = new Date("2026-08-07T06:00:00Z"); // BS 2083-04-22

function balancedLines() {
  return [
    { accountCode: ACCOUNT.CASH_WITH_RIDER, debit: 500, party: { type: "rider" as const, id: "rider-1" } },
    { accountCode: ACCOUNT.VENDOR_CONTROL, credit: 500, party: { type: "vendor" as const, id: "vendor-1" } },
  ];
}

function post(db: ReturnType<typeof fakeDb>, overrides: Partial<Parameters<typeof postJournal>[1]> = {}): Promise<PostOutcome> {
  return postJournal(asDb(db), {
    entryDate: ENTRY_DATE,
    sourceType: "cod_collection",
    sourceId: "11111111-1111-1111-1111-111111111111",
    eventKey: "cod_collected",
    lines: balancedLines(),
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The account cache is process-wide and would otherwise leak rows between
  // tests that deliberately configure different account sets.
  clearAccountCache();
});

describe("postJournal - the balance invariant", () => {
  it("posts a balanced entry and writes one line per side", async () => {
    const db = fakeDb();
    const outcome = await post(db);

    expect(wasPosted(outcome) && outcome.created).toBe(true);
    expect(db.createdLines).toHaveLength(2);
    expect(db.createdLines[0]).toMatchObject({ account_id: "acct-rider", line_no: 1, party_type: "rider", party_id: "rider-1" });
    expect(db.createdLines[1]).toMatchObject({ account_id: "acct-vendor", line_no: 2, party_type: "vendor", party_id: "vendor-1" });
  });

  it("rejects an entry whose debits and credits differ", async () => {
    const db = fakeDb();
    await expect(
      post(db, {
        lines: [
          { accountCode: ACCOUNT.CASH_WITH_RIDER, debit: 500, party: { type: "rider", id: "rider-1" } },
          { accountCode: ACCOUNT.VENDOR_CONTROL, credit: 400, party: { type: "vendor", id: "vendor-1" } },
        ],
      }),
    ).rejects.toThrow(/does not balance: debits 500.00, credits 400.00/);
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("compares at the stored 2dp scale, not at full precision", async () => {
    // 100.005 and 100.004 both round to 100.00 in a DECIMAL(14,2) column. If
    // the balance check ran before rounding it would reject this pair; if it
    // never rounded at all the database would reject it later, far from here.
    const db = fakeDb();
    const outcome = await post(db, {
      lines: [
        { accountCode: ACCOUNT.CASH_IN_HAND, debit: "100.004" },
        { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: "100.0049" },
      ],
    });

    expect(wasPosted(outcome) && outcome.created).toBe(true);
    expect(String(db.createdLines[0]!.debit)).toBe("100");
    expect(String(db.createdLines[1]!.credit)).toBe("100");
  });

  it("refuses a line carrying both a debit and a credit", async () => {
    const db = fakeDb();
    await expect(
      post(db, { lines: [{ accountCode: ACCOUNT.CASH_IN_HAND, debit: 100, credit: 100 }, ...balancedLines()] }),
    ).rejects.toThrow(/carries both a debit and a credit/);
  });

  it("refuses a negative amount instead of quietly flipping the side", async () => {
    const db = fakeDb();
    await expect(
      post(db, {
        lines: [
          { accountCode: ACCOUNT.CASH_IN_HAND, debit: -100 },
          { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: -100 },
        ],
      }),
    ).rejects.toThrow(/negative amount/);
  });

  it("drops zero-value lines but keeps the entry", async () => {
    const db = fakeDb();
    const outcome = await post(db, {
      lines: [...balancedLines(), { accountCode: ACCOUNT.CASH_IN_HAND, debit: 0 }],
    });

    expect(wasPosted(outcome)).toBe(true);
    expect(db.createdLines).toHaveLength(2);
  });

  it("skips entirely when every line is zero", async () => {
    const db = fakeDb();
    const outcome = await post(db, {
      lines: [
        { accountCode: ACCOUNT.CASH_IN_HAND, debit: 0 },
        { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: 0 },
      ],
    });

    expect(outcome).toEqual({ skipped: true, reason: "every line was zero" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("refuses a single-sided entry", async () => {
    const db = fakeDb();
    await expect(
      post(db, { lines: [{ accountCode: ACCOUNT.CASH_IN_HAND, debit: 100 }, { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: 0 }] }),
    ).rejects.toThrow(/does not balance|at least two lines/);
  });
});

describe("postJournal - control accounts", () => {
  it("requires a party on a control account", async () => {
    const db = fakeDb();
    await expect(
      post(db, {
        lines: [
          { accountCode: ACCOUNT.CASH_WITH_RIDER, debit: 500 },
          { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: 500 },
        ],
      }),
    ).rejects.toThrow(/1010 is a control account and requires a party/);
  });

  it("requires the party to match the account's subledger dimension", async () => {
    const db = fakeDb();
    await expect(
      post(db, {
        lines: [
          { accountCode: ACCOUNT.CASH_WITH_RIDER, debit: 500, party: { type: "vendor", id: "vendor-1" } },
          { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: 500 },
        ],
      }),
    ).rejects.toThrow(/keeps a rider subledger, but the line names a vendor/);
  });

  it("allows a party on a plain account without demanding one", async () => {
    const db = fakeDb();
    const outcome = await post(db, {
      lines: [
        { accountCode: ACCOUNT.CASH_IN_HAND, debit: 500 },
        { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: 500 },
      ],
    });

    expect(wasPosted(outcome)).toBe(true);
    expect(db.createdLines[0]).toMatchObject({ party_type: null, party_id: null });
  });

  it("reports an account code that is not in the chart", async () => {
    const db = fakeDb();
    await expect(
      post(db, {
        lines: [
          { accountCode: "9999", debit: 500 },
          { accountCode: ACCOUNT.DELIVERY_REVENUE, credit: 500 },
        ],
      }),
    ).rejects.toThrow(/Unknown ledger account code\(s\): 9999/);
  });
});

describe("postJournal - idempotency", () => {
  it("returns the existing entry without writing when the event was already posted", async () => {
    const db = fakeDb({ existingEntry: { id: "entry-old", entry_no: "JE-2083-000007", period_key: "2083-04" } });
    const outcome = await post(db);

    expect(outcome).toEqual({ id: "entry-old", entryNo: "JE-2083-000007", periodKey: "2083-04", created: false });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("yields to the winner when a concurrent transaction posted the same event first", async () => {
    // ON CONFLICT DO NOTHING returns no rows: the other transaction committed
    // between the existence check and the insert.
    const db = fakeDb({ insertReturns: [] });
    db.journal_entries.findFirstOrThrow.mockResolvedValue({
      id: "entry-winner",
      entry_no: "JE-2083-000009",
      period_key: "2083-04",
    });

    const outcome = await post(db);

    expect(outcome).toEqual({ id: "entry-winner", entryNo: "JE-2083-000009", periodKey: "2083-04", created: false });
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });
});

describe("postJournal - periods", () => {
  it("derives the period from the event date, not from today", async () => {
    const db = fakeDb();
    const outcome = await post(db, { entryDate: new Date("2026-08-07T06:00:00Z") });

    expect(wasPosted(outcome) && outcome.periodKey).toBe("2083-04");
  });

  it("creates the period on first use", async () => {
    const db = fakeDb({ periodStatus: "missing" });
    await post(db);
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it("refuses to post into a closed period", async () => {
    const db = fakeDb({ periodStatus: "closed" });
    await expect(post(db)).rejects.toThrow(/Accounting period 2083-04 is closed/);
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("stamps every line with the entry's date", async () => {
    const db = fakeDb();
    await post(db);
    for (const line of db.createdLines) expect(line.entry_date).toEqual(ENTRY_DATE);
  });
});

describe("reverseJournal", () => {
  const original = {
    id: "entry-1",
    entry_no: "JE-2083-000001",
    entry_date: ENTRY_DATE,
    status: "posted" as const,
    lines: [
      {
        debit: new Prisma.Decimal(500),
        credit: new Prisma.Decimal(0),
        party_type: "rider" as const,
        party_id: "rider-1",
        location_id: null,
        parcel_id: "parcel-1",
        memo: null,
        account: { code: ACCOUNT.CASH_WITH_RIDER },
      },
      {
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(500),
        party_type: "vendor" as const,
        party_id: "vendor-1",
        location_id: null,
        parcel_id: "parcel-1",
        memo: null,
        account: { code: ACCOUNT.VENDOR_CONTROL },
      },
    ],
  };

  it("posts the mirror image and voids the original", async () => {
    const db = fakeDb({ insertReturns: [{ id: "entry-rev", entry_no: "JE-2083-000002" }] });
    db.journal_entries.findUnique.mockResolvedValue(original);

    const outcome = await reverseJournal(asDb(db), { entryId: "entry-1", reason: "statement corrected" });

    expect(wasPosted(outcome) && outcome.created).toBe(true);
    // Every side is flipped.
    expect(db.createdLines[0]).toMatchObject({ account_id: "acct-rider", party_id: "rider-1" });
    expect(String(db.createdLines[0]!.debit)).toBe("0");
    expect(String(db.createdLines[0]!.credit)).toBe("500");
    expect(String(db.createdLines[1]!.debit)).toBe("500");
    expect(String(db.createdLines[1]!.credit)).toBe("0");
    // Dimensions carry over, so the reversal lands in the same subledgers.
    expect(db.createdLines[1]).toMatchObject({ party_type: "vendor", parcel_id: "parcel-1" });

    expect(db.journal_entries.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "entry-1" }, data: { status: "voided" } }),
    );
  });

  it("books the reversal in the original's period by default", async () => {
    const db = fakeDb({ insertReturns: [{ id: "entry-rev", entry_no: "JE-2083-000002" }] });
    db.journal_entries.findUnique.mockResolvedValue(original);

    const outcome = await reverseJournal(asDb(db), { entryId: "entry-1", reason: "correction" });
    expect(wasPosted(outcome) && outcome.periodKey).toBe("2083-04");
  });

  it("refuses to reverse an entry twice", async () => {
    const db = fakeDb();
    db.journal_entries.findUnique.mockResolvedValue({ ...original, status: "voided" });

    await expect(reverseJournal(asDb(db), { entryId: "entry-1", reason: "again" })).rejects.toThrow(
      /has already been reversed/,
    );
  });

  it("reports a missing entry rather than posting nothing quietly", async () => {
    const db = fakeDb();
    db.journal_entries.findUnique.mockResolvedValue(null);
    await expect(reverseJournal(asDb(db), { entryId: "nope", reason: "x" })).rejects.toThrow(/not found/);
  });
});

describe("cashAccountForMethod", () => {
  // What loadMethodAccounts returns: every method an admin has added owns an
  // account, and this map is how a payment finds it.
  const methodAccounts = new Map([
    ["prabhu bank", "1100"],
    ["kumari bank", "1101"],
    ["esewa", "1102"],
  ]);

  it("routes a method to the account it owns", () => {
    expect(cashAccountForMethod("prabhu bank", methodAccounts)).toBe("1100");
    expect(cashAccountForMethod("Kumari Bank", methodAccounts)).toBe("1101");
    expect(cashAccountForMethod("eSewa", methodAccounts)).toBe("1102");
  });

  it("sends cash to Cash in Hand even before the method row has an account", () => {
    // The one name the chart itself covers, so a fresh install posts cash
    // correctly before any backfill has run.
    expect(cashAccountForMethod("cash")).toBe(ACCOUNT.CASH_IN_HAND);
    expect(cashAccountForMethod("Cash")).toBe(ACCOUNT.CASH_IN_HAND);
    expect(cashAccountForMethod("Cash in hand")).toBe(ACCOUNT.CASH_IN_HAND);
  });

  it("returns null for a method with no account, rather than guessing", () => {
    // There is no family fallback and no catch-all: the caller refuses to post.
    // Folding an unrecognised bank transfer into Cash would misstate the cash
    // balance and hide that a method needs adding.
    expect(cashAccountForMethod("crypto", methodAccounts)).toBeNull();
    expect(cashAccountForMethod("Bank Transfer", methodAccounts)).toBeNull();
    expect(cashAccountForMethod(null)).toBeNull();
    expect(cashAccountForMethod("")).toBeNull();
    expect(cashAccountForMethod("   ")).toBeNull();
  });
});
