import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({ default: {}, pool: {} }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() }, scanAndDelete: vi.fn() }));

import { Prisma } from "../../generated/prisma/client";
import { ACCOUNT, clearAccountCache } from "../accounting/accounts";
import { syncPosting } from "../accounting/posting.service";

// syncPosting is where the ledger meets a system whose records change after the
// fact. Both bugs found in integration testing lived here, so both have a test.

const ACCOUNT_ROWS = [
  { id: "acct-cash", code: ACCOUNT.CASH_IN_HAND, is_control: false, subledger_type: null, is_active: true },
  { id: "acct-rider", code: ACCOUNT.CASH_WITH_RIDER, is_control: true, subledger_type: "rider", is_active: true },
  { id: "acct-vendor", code: ACCOUNT.VENDOR_CONTROL, is_control: true, subledger_type: "vendor", is_active: true },
];

const ENTRY_DATE = new Date("2026-08-07T06:00:00Z"); // BS 2083-04-22
const SAME_PERIOD_LATER = new Date("2026-08-09T11:30:00Z"); // BS 2083-04-24, same month
const NEXT_PERIOD = new Date("2026-09-20T06:00:00Z"); // BS 2083-05, a different month

/** An entry as syncPosting reads it back out of the database. */
function existingEntry(amount: number, entryDate = ENTRY_DATE, status: "posted" | "voided" = "posted") {
  return {
    id: "entry-1",
    entry_no: "JE-2083-000001",
    entry_date: entryDate,
    period_key: "2083-04",
    status,
    lines: [
      {
        debit: new Prisma.Decimal(amount),
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
        credit: new Prisma.Decimal(amount),
        party_type: "vendor" as const,
        party_id: "vendor-1",
        location_id: null,
        parcel_id: "parcel-1",
        memo: null,
        account: { code: ACCOUNT.VENDOR_CONTROL },
      },
    ],
  };
}

function fakeDb(history: ReturnType<typeof existingEntry>[] = []) {
  const db = {
    createdLines: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,

    accounting_periods: { findUnique: vi.fn().mockResolvedValue({ status: "open" }) },
    ledger_accounts: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        ACCOUNT_ROWS.filter((row) => where.code.in.includes(row.code)),
      ),
    },
    journal_entries: {
      findMany: vi.fn().mockResolvedValue(history),
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn(),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        history.find((entry) => entry.id === where.id) ?? null,
      ),
      update: vi.fn(async (args: Record<string, unknown>) => {
        db.updates.push(args);
        return {};
      }),
    },
    journal_lines: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        db.createdLines.push(...data);
        return { count: data.length };
      }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "entry-new", entry_no: "JE-2083-000002" }]),
  };
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: ReturnType<typeof fakeDb>) => db as any;

const desired = (amount: number, entryDate = ENTRY_DATE) => ({
  entryDate,
  memo: "COD collected on delivery",
  lines: [
    { accountCode: ACCOUNT.CASH_WITH_RIDER, debit: amount, party: { type: "rider" as const, id: "rider-1" } },
    { accountCode: ACCOUNT.VENDOR_CONTROL, credit: amount, party: { type: "vendor" as const, id: "vendor-1" } },
  ],
});

const sync = (db: ReturnType<typeof fakeDb>, want: ReturnType<typeof desired> | null) =>
  syncPosting(asDb(db), {
    sourceType: "cod_collection",
    sourceId: "11111111-1111-1111-1111-111111111111",
    baseEventKey: "cod_collected",
    desired: want,
    reason: "test",
    redateIfClosed: true,
  });

beforeEach(() => {
  vi.clearAllMocks();
  clearAccountCache();
});

describe("syncPosting - converging to the desired state", () => {
  it("posts when nothing is there yet", async () => {
    const db = fakeDb([]);
    expect(await sync(db, desired(1200))).toBe("posted");
    expect(db.createdLines).toHaveLength(2);
  });

  it("does nothing when the ledger already agrees", async () => {
    const db = fakeDb([existingEntry(1200)]);
    expect(await sync(db, desired(1200))).toBe("unchanged");
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
    expect(db.journal_entries.update).not.toHaveBeenCalled();
  });

  it("reverses when the posting should no longer exist", async () => {
    // What an un-delivery or a soft-delete looks like from here.
    const db = fakeDb([existingEntry(1200)]);
    expect(await sync(db, null)).toBe("reversed");
    // The mirror image: the original's debit comes back as a credit.
    expect(String(db.createdLines[0]!.credit)).toBe("1200");
    expect(db.updates.some((u) => JSON.stringify(u).includes("voided"))).toBe(true);
  });

  it("does nothing when there is nothing to reverse", async () => {
    const db = fakeDb([]);
    expect(await sync(db, null)).toBe("unchanged");
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("restates when the amount changes", async () => {
    // A partial delivery correcting 1200 down to 700.
    const db = fakeDb([existingEntry(1200)]);
    expect(await sync(db, desired(700))).toBe("reposted");
    // Reversal first (1200 back out), then the new figure.
    expect(db.createdLines.map((l) => String(l.debit))).toEqual(["0", "1200", "700", "0"]);
  });

  it("versions the event key so a restatement is not blocked by the original", async () => {
    // The idempotency index is unique on (source, event_key); reusing the key
    // for a correction would silently no-op instead of restating.
    const db = fakeDb([existingEntry(1200)]);
    await sync(db, desired(700));
    const sql = JSON.stringify(db.$queryRaw.mock.calls);
    expect(sql).toContain("cod_collected#2");
  });
});

describe("syncPosting - churn", () => {
  it("ignores a timestamp that moved within the same period", async () => {
    // Re-scanning a delivered parcel rewrites collected_at to now. Nothing
    // about the money changed, and reversing plus re-posting on every duplicate
    // scan would fill the journal with pairs that cancel out and say nothing.
    const db = fakeDb([existingEntry(1200, ENTRY_DATE)]);
    expect(await sync(db, desired(1200, SAME_PERIOD_LATER))).toBe("unchanged");
    expect(db.journal_lines.createMany).not.toHaveBeenCalled();
  });

  it("does restate when the event moves into a different period", async () => {
    // Here the month it lands in genuinely changes, which the books care about.
    const db = fakeDb([existingEntry(1200, ENTRY_DATE)]);
    expect(await sync(db, desired(1200, NEXT_PERIOD))).toBe("reposted");
  });
});

describe("syncPosting - closed periods", () => {
  it("books into the current period rather than refusing", async () => {
    // An operational event cannot be told to happen in a different month, so a
    // closed period must not be able to block a delivery from being recorded.
    const db = fakeDb([]);
    db.accounting_periods.findUnique.mockResolvedValue({ status: "closed" });

    expect(await sync(db, desired(1200))).toBe("posted");

    // Re-dated to now, and the entry says so.
    const posted = JSON.stringify(db.$queryRaw.mock.calls);
    expect(posted).toContain("that period is closed");
  });
});
