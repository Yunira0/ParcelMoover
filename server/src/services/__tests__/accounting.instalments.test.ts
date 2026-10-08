import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/prisma", () => ({ default: {}, pool: {} }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() }, scanAndDelete: vi.fn() }));

import { Prisma } from "../../generated/prisma/client";
import { ACCOUNT, CHART_OF_ACCOUNTS, clearAccountCache } from "../accounting/accounts";
import {
  allocateInstalments,
  describeBranchInstalment,
  describeBranchSettlement,
  describeBranchStatement,
  describeCarrierInstalment,
  describeCarrierSettlement,
  describeCarrierStatement,
  describeRiderRemittance,
  describeVendorSettlement,
  isSkip,
  postVendorSettlement,
  UNRECORDED_INSTALMENT,
  type Described,
} from "../accounting/events";
import { syncSettlementPostings } from "../accounting/sync";

// A statement posts once and each instalment posts its own entry, so paying
// never reverses anything. These tests hold the split to two promises: it adds
// entries instead of restating them, and it never moves a balance compared to
// the one-entry posting it replaces.

const BANK = "1100";
const METHOD_ACCOUNTS = new Map([["bank transfer", BANK], ["cash", ACCOUNT.CASH_IN_HAND]]);

const ACCOUNT_ROWS = [
  ...CHART_OF_ACCOUNTS.map((account) => ({
    id: `acct-${account.code}`,
    code: account.code,
    is_control: account.isControl ?? false,
    subledger_type: account.subledgerType ?? null,
    is_active: true,
  })),
  { id: `acct-${BANK}`, code: BANK, is_control: false, subledger_type: null, is_active: true },
];

interface FakeLine {
  account_id: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  party_type: string | null;
  party_id: string | null;
  location_id: string | null;
  parcel_id: string | null;
  memo: string | null;
  account: { code: string };
}

interface FakeEntry {
  id: string;
  entry_no: string;
  entry_date: Date;
  period_key: string;
  status: string;
  source_type: string;
  source_id: string | null;
  event_key: string;
  reversal_of_id: string | null;
  lines: FakeLine[];
}

type Where = Record<string, unknown>;

function matches(entry: FakeEntry, where: Where): boolean {
  return Object.entries(where).every(([field, want]) => {
    if (field === "OR") return (want as Where[]).some((branch) => matches(entry, branch));
    const have = (entry as unknown as Record<string, unknown>)[field];
    if (want && typeof want === "object" && "startsWith" in want) {
      return typeof have === "string" && have.startsWith((want as { startsWith: string }).startsWith);
    }
    return have === want;
  });
}

/** Just enough of Prisma for the posting path to run against an in-memory journal. */
function fakeLedger(settlement: Record<string, unknown>) {
  const entries: FakeEntry[] = [];
  const state = { settlement };

  const db = {
    entries,
    state,
    settlements: { findMany: vi.fn(async () => [state.settlement]) },
    payment_methods: {
      findMany: vi.fn(async () => [
        { name: "Bank Transfer", ledger_account: { code: BANK } },
        { name: "Cash", ledger_account: { code: ACCOUNT.CASH_IN_HAND } },
      ]),
    },
    accounting_periods: { findUnique: vi.fn(async () => ({ status: "open" })) },
    ledger_accounts: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        ACCOUNT_ROWS.filter((row) => where.code.in.includes(row.code)),
      ),
    },
    journal_entries: {
      findMany: vi.fn(async ({ where }: { where: Where }) => entries.filter((entry) => matches(entry, where))),
      findFirst: vi.fn(async ({ where }: { where: Where }) => entries.find((entry) => matches(entry, where)) ?? null),
      findFirstOrThrow: vi.fn(),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => entries.find((entry) => entry.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeEntry> }) => {
        Object.assign(entries.find((entry) => entry.id === where.id)!, data);
        return {};
      }),
    },
    journal_lines: {
      createMany: vi.fn(async ({ data }: { data: Array<Omit<FakeLine, "account"> & { entry_id: string }> }) => {
        const entry = entries.find((candidate) => candidate.id === data[0]!.entry_id)!;
        entry.lines.push(...data.map((line) => ({ ...line, account: { code: line.account_id.replace("acct-", "") } })));
        return { count: data.length };
      }),
    },
    $executeRaw: vi.fn(async () => 1),
    // Only postJournal's INSERT reaches here; its values are in column order.
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const [, entryDate, , periodKey, , sourceType, sourceId, eventKey] = values;
      const id = `entry-${entries.length + 1}`;
      entries.push({
        id,
        entry_no: `JE-${entries.length + 1}`,
        entry_date: entryDate as Date,
        period_key: periodKey as string,
        status: "posted",
        source_type: sourceType as string,
        source_id: sourceId as string | null,
        event_key: eventKey as string,
        reversal_of_id: null,
        lines: [],
      });
      return [{ id, entry_no: `JE-${entries.length}` }];
    }),
  };
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: ReturnType<typeof fakeLedger>) => db as any;

const live = (db: ReturnType<typeof fakeLedger>) => db.entries.filter((entry) => entry.status === "posted" && entry.source_type !== "reversal");
const reversals = (db: ReturnType<typeof fakeLedger>) => db.entries.filter((entry) => entry.source_type === "reversal");

/** Net balance per account and party, across everything posted. A voided entry and its reversal cancel out. */
function balances(lines: Array<{ code: string; debit: unknown; credit: unknown; party: string | null }>) {
  const net = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const key = `${line.code}|${line.party ?? ""}`;
    const delta = new Prisma.Decimal(String(line.debit ?? 0)).minus(new Prisma.Decimal(String(line.credit ?? 0)));
    net.set(key, (net.get(key) ?? new Prisma.Decimal(0)).plus(delta));
  }
  return Object.fromEntries([...net].filter(([, amount]) => !amount.isZero()).map(([key, amount]) => [key, amount.toFixed(2)]));
}

const ledgerBalances = (db: ReturnType<typeof fakeLedger>) =>
  balances(db.entries.flatMap((entry) => entry.lines.map((line) => ({ code: line.account.code, debit: line.debit, credit: line.credit, party: line.party_id }))));

const describedBalances = (...described: Described[]) =>
  balances(
    described.flatMap((one) => {
      if (isSkip(one)) return [];
      return one.lines.map((line) => ({ code: line.accountCode, debit: line.debit, credit: line.credit, party: line.party?.id ?? null }));
    }),
  );

const instalment = (id: string, amount: number, method: string, day: number) => ({
  id,
  amount: new Prisma.Decimal(amount),
  method,
  breakdown: [{ method, amount }],
  paid_at: new Date(`2026-08-${String(day).padStart(2, "0")}T06:00:00Z`),
});

const vendorStatement = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  statement_id: "VS-100",
  payee_type: "vendor",
  rider_id: null,
  vendor_id: "vendor-1",
  amount: new Prisma.Decimal(11000),
  payable_amount: new Prisma.Decimal(10000),
  payment_method: null,
  payments: null,
  paid_amount: new Prisma.Decimal(0),
  vendor_credit_applied: new Prisma.Decimal(0),
  settlement_date: new Date("2026-08-07T06:00:00Z"),
  updated_at: new Date("2026-08-07T06:00:00Z"),
  status: "pending",
  riders: null,
  vendors: { client_name: "Eve", business_name: "Eve collection" },
  settlement_items: [],
  settlement_payments: [] as ReturnType<typeof instalment>[],
  ...overrides,
});

/** Records an instalment the way payForSettlement leaves the row. */
function pay(db: ReturnType<typeof fakeLedger>, row: ReturnType<typeof instalment>) {
  const current = db.state.settlement as ReturnType<typeof vendorStatement>;
  const payments = [...current.settlement_payments, row];
  const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
  db.state.settlement = {
    ...current,
    settlement_payments: payments,
    paid_amount: paid,
    payments: payments.flatMap((payment) => payment.breakdown),
    payment_method: [...new Set(payments.map((payment) => payment.method))].join(", "),
    status: paid.equals(current.payable_amount) ? "settled" : "partially_paid",
  };
}

const sync = (db: ReturnType<typeof fakeLedger>) =>
  syncSettlementPostings(asDb(db), [String((db.state.settlement as { id: string }).id)], { reason: "test" });

beforeEach(() => {
  vi.clearAllMocks();
  clearAccountCache();
});

describe("statement instalments - paying adds entries, never reverses", () => {
  it("posts the statement once on creation, with no cash in it", async () => {
    const db = fakeLedger(vendorStatement());
    await sync(db);

    expect(live(db).map((entry) => entry.event_key)).toEqual(["vendor_statement"]);
    expect(live(db)[0]!.lines.map((line) => line.account.code)).not.toContain(BANK);
  });

  it("adds one entry per payment and leaves everything already posted alone", async () => {
    const db = fakeLedger(vendorStatement());
    await sync(db);
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);
    pay(db, instalment("pay-2", 4000, "Cash", 12));
    await sync(db);

    expect(live(db).map((entry) => entry.event_key)).toEqual([
      "vendor_statement",
      "vendor_statement_payment:pay-1",
      "vendor_statement_payment:pay-2",
    ]);
    expect(reversals(db)).toHaveLength(0);

    const second = live(db)[2]!;
    expect(second.entry_date).toEqual(new Date("2026-08-12T06:00:00Z"));
    expect(second.lines.map((line) => [line.account.code, line.debit.toFixed(2), line.credit.toFixed(2)])).toEqual([
      [ACCOUNT.VENDOR_CONTROL, "4000.00", "0.00"],
      [ACCOUNT.CASH_IN_HAND, "0.00", "4000.00"],
    ]);
  });

  it("does nothing on a re-sync when nothing changed", async () => {
    const db = fakeLedger(vendorStatement());
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);
    const before = db.entries.length;

    const summary = await sync(db);
    expect(summary.changed).toBe(0);
    expect(db.entries).toHaveLength(before);
  });

  it("ends on exactly the balances the one-entry posting gave", async () => {
    const db = fakeLedger(vendorStatement());
    await sync(db);
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);
    pay(db, instalment("pay-2", 4000, "Cash", 12));
    await sync(db);

    const settled = db.state.settlement as ReturnType<typeof vendorStatement>;
    expect(ledgerBalances(db)).toEqual(
      describedBalances(describeVendorSettlement({ ...settled, methodAccounts: METHOD_ACCOUNTS })),
    );
  });

  it("reverses only the payment entries when a payment is reverted", async () => {
    const db = fakeLedger(vendorStatement());
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);

    db.state.settlement = { ...db.state.settlement, settlement_payments: [], paid_amount: new Prisma.Decimal(0), status: "pending" };
    await sync(db);

    expect(live(db).map((entry) => entry.event_key)).toEqual(["vendor_statement"]);
    expect(reversals(db)).toHaveLength(1);
  });

  it("clears every entry when the statement is cancelled", async () => {
    const db = fakeLedger(vendorStatement());
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);

    db.state.settlement = { ...db.state.settlement, status: "cancelled" };
    await sync(db);

    expect(live(db)).toHaveLength(0);
    expect(ledgerBalances(db)).toEqual({});
  });

  it("posts a rider's hand-over as a debt on the rider, cleared by each payment", async () => {
    const db = fakeLedger(
      vendorStatement({
        payee_type: "rider",
        rider_id: "rider-1",
        vendor_id: null,
        amount: new Prisma.Decimal(13836),
        payable_amount: new Prisma.Decimal(13836),
        riders: { name: "Prashant" },
        vendors: null,
      }),
    );
    pay(db, instalment("pay-1", 13836, "Bank Transfer", 9));
    await sync(db);

    expect(live(db).map((entry) => entry.event_key)).toEqual(["rider_statement", "rider_statement_payment:pay-1"]);
    const settled = db.state.settlement as ReturnType<typeof vendorStatement>;
    expect(ledgerBalances(db)).toEqual(
      describedBalances(describeRiderRemittance({ ...settled, methodAccounts: METHOD_ACCOUNTS })),
    );
  });
});

describe("statement instalments - LEDGER_PER_PAYMENT_POSTINGS=off", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("posts one entry per statement while switched off", async () => {
    vi.stubEnv("LEDGER_PER_PAYMENT_POSTINGS", "off");
    const db = fakeLedger(vendorStatement());
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);

    expect(live(db).map((entry) => entry.event_key)).toEqual(["vendor_settlement"]);
  });

  it("unwinds per-payment entries back to one entry, on the same balances", async () => {
    const db = fakeLedger(vendorStatement());
    await sync(db);
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);

    vi.stubEnv("LEDGER_PER_PAYMENT_POSTINGS", "off");
    await sync(db);

    expect(live(db).map((entry) => entry.event_key)).toEqual(["vendor_settlement"]);
    const current = db.state.settlement as ReturnType<typeof vendorStatement>;
    expect(ledgerBalances(db)).toEqual(
      describedBalances(describeVendorSettlement({ ...current, methodAccounts: METHOD_ACCOUNTS })),
    );
  });

  it("moves back to per-payment entries when switched on again", async () => {
    vi.stubEnv("LEDGER_PER_PAYMENT_POSTINGS", "off");
    const db = fakeLedger(vendorStatement());
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await sync(db);

    vi.unstubAllEnvs();
    pay(db, instalment("pay-2", 4000, "Cash", 12));
    await sync(db);

    expect(live(db).map((entry) => entry.event_key)).toEqual([
      "vendor_statement",
      "vendor_statement_payment:pay-1",
      "vendor_statement_payment:pay-2",
    ]);
  });
});

describe("statement instalments - statements posted the old way", () => {
  it("leaves an old one-entry posting alone while it is still right", async () => {
    const db = fakeLedger(vendorStatement());
    pay(db, instalment("pay-1", 10000, "Bank Transfer", 9));
    await postVendorSettlement(asDb(db), { ...(db.state.settlement as ReturnType<typeof vendorStatement>), methodAccounts: METHOD_ACCOUNTS });

    const summary = await sync(db);
    expect(summary.changed).toBe(0);
    expect(db.entries.map((entry) => entry.event_key)).toEqual(["vendor_settlement"]);
  });

  it("switches a part-paid one over on its next payment, at the cost of one reversal", async () => {
    const db = fakeLedger(vendorStatement());
    pay(db, instalment("pay-1", 6000, "Bank Transfer", 9));
    await postVendorSettlement(asDb(db), { ...(db.state.settlement as ReturnType<typeof vendorStatement>), methodAccounts: METHOD_ACCOUNTS });

    pay(db, instalment("pay-2", 4000, "Cash", 12));
    await sync(db);

    expect(reversals(db)).toHaveLength(1);
    expect(live(db).map((entry) => entry.event_key)).toEqual([
      "vendor_statement",
      "vendor_statement_payment:pay-1",
      "vendor_statement_payment:pay-2",
    ]);
    const settled = db.state.settlement as ReturnType<typeof vendorStatement>;
    expect(ledgerBalances(db)).toEqual(
      describedBalances(describeVendorSettlement({ ...settled, methodAccounts: METHOD_ACCOUNTS })),
    );
  });
});

describe("allocateInstalments", () => {
  const header = { payment_method: "Cash", payments: [{ method: "Cash", amount: 300 }] };

  it("shares the paid amount out oldest first", () => {
    const shares = allocateInstalments(
      { ...header, paid_amount: 700 },
      [instalment("b", 400, "Cash", 12), instalment("a", 300, "Cash", 9)],
      new Prisma.Decimal(1000),
      new Date(),
    );
    expect(shares.map((share) => [share.id, share.amount.toFixed(2)])).toEqual([["a", "300.00"], ["b", "400.00"]]);
  });

  it("never shares out more than the statement can absorb", () => {
    const shares = allocateInstalments(
      { ...header, paid_amount: 1200 },
      [instalment("a", 600, "Cash", 9), instalment("b", 600, "Cash", 12)],
      new Prisma.Decimal(1000),
      new Date(),
    );
    expect(shares.map((share) => [share.id, share.amount.toFixed(2)])).toEqual([["a", "600.00"], ["b", "400.00"]]);
  });

  it("keeps paid money no instalment row accounts for, at the header's methods", () => {
    const shares = allocateInstalments({ ...header, paid_amount: 300 }, [], new Prisma.Decimal(1000), new Date());
    expect(shares).toEqual([expect.objectContaining({ id: UNRECORDED_INSTALMENT, method: "Cash" })]);
    expect(shares[0]!.amount.toFixed(2)).toBe("300.00");
  });
});

describe("branch and 3PL statements split the same way", () => {
  it("moves a branch's net off 1015 as each instalment lands", () => {
    const branch = {
      id: "brs-1", statement_no: "BRS-1", from_branch_id: "branch-1", to_branch_id: "imadol",
      gross_cod: 1000, commission_amount: 100, net_payable: 900, paid_amount: 600,
      payment_method: "Bank Transfer", payments: null, settlement_date: new Date("2026-09-01"),
      methodAccounts: METHOD_ACCOUNTS,
    };
    const shares = allocateInstalments(branch, [instalment("p1", 600, "Bank Transfer", 3)], new Prisma.Decimal(900), branch.settlement_date);

    expect(describedBalances(describeBranchStatement(branch), ...shares.map((share) => describeBranchInstalment(branch, share)))).toEqual(
      describedBalances(describeBranchSettlement(branch)),
    );
  });

  it("moves a 3PL's net off 1020 as each instalment lands", () => {
    const carrier = {
      id: "cs-1", statement_no: "CS-1", carrier_code: "ncm",
      gross_cod: 1000, carrier_charges: 100, net_receivable: 900, paid_amount: 900,
      payment_method: "Cash", payments: null, settlement_date: new Date("2026-09-01"),
      methodAccounts: METHOD_ACCOUNTS,
      vendor_shares: [{ vendorId: "vendor-a", amount: 600 }, { vendorId: "vendor-b", amount: 400 }],
    };
    const shares = allocateInstalments(
      carrier,
      [instalment("p1", 500, "Cash", 3), instalment("p2", 400, "Bank Transfer", 5)],
      new Prisma.Decimal(900),
      carrier.settlement_date,
    );

    expect(describedBalances(describeCarrierStatement(carrier), ...shares.map((share) => describeCarrierInstalment(carrier, share)))).toEqual(
      describedBalances(
        describeCarrierSettlement({
          ...carrier,
          payment_method: "Cash, Bank Transfer",
          payments: [{ method: "Cash", amount: 500 }, { method: "Bank Transfer", amount: 400 }],
        }),
      ),
    );
  });
});
