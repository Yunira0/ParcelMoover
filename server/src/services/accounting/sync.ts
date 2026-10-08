// The seam between operations and the books.
//
// Everything the rest of the server needs to call lives here, and all of it
// takes the same shape: "this row changed - make the ledger true again". No
// caller has to know whether that means a first posting, a reversal, or a
// restatement, and no caller has to work out whether it has already been done.
//
// Two rules govern this file, and they are why it exists at all:
//
//   1. Operations must never be blocked by the books. A delivery gets recorded
//      whether or not its journal entry can be written. A ledger that can fail
//      a parcel scan is a ledger that gets ripped out within a week.
//
//   2. Silence is not allowed. Anything skipped is logged loudly and will be
//      caught by reconcile-ledger.ts, which compares the books against the
//      source data independently. Failing quietly is the one outcome worse
//      than failing.
//
// Together those mean: try hard, never throw at the caller, always leave a
// trail.
import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
  allocateInstalments,
  describeBranchInstalment,
  describeBranchSettlement,
  describeBranchStatement,
  describeCarrierInstalment,
  describeCarrierSettlement,
  describeCarrierStatement,
  describeExpense,
  describeRiderInstalment,
  describeRiderRemittance,
  describeRiderStatement,
  describeVendorInstalment,
  describeVendorPaymentVerified,
  describeVendorSettlement,
  describeVendorStatement,
  EVENT_KEY,
  instalmentEventKey,
  instalmentKeyPrefix,
  isSkip,
  SOURCE,
  type Described,
  type PostingDescriptor,
} from "./events";
import { loadMethodAccounts } from "./accounts";
import { isPostingCurrent, syncPosting, type SyncResult } from "./posting.service";
import { isReturnLeg } from "../money-rules";

const { Decimal } = Prisma;

type Db = Prisma.TransactionClient | typeof prisma;

interface SyncOptions {
  actorId?: string | null | undefined;
  reason?: string | undefined;
}

/**
 * What a sync actually did, for callers that need to know.
 *
 * Almost nobody does - the point of this file is that callers say "make it
 * true" and stop thinking about it. The sweep is the exception: "how many
 * entries did I have to repair" is the only number that tells you whether the
 * fire-and-forget path is healthy, and asking the database afterwards would
 * cost a query to learn something the sync already knew.
 */
export interface SyncSummary {
  /** Postings written, reversed or restated. Zero means the books already agreed. */
  changed: number;
  /** Rows whose descriptor could not be built. Logged, and left untouched. */
  unresolved: number;
}

const noChange = (): SyncSummary => ({ changed: 0, unresolved: 0 });

function record(summary: SyncSummary, result: SyncResult | "unresolved"): void {
  if (result === "unresolved") summary.unresolved += 1;
  else if (result !== "unchanged" && result !== "skipped") summary.changed += 1;
}

/**
 * Resolves a descriptor into what syncPosting should aim for.
 *
 * The three-way result matters. A descriptor means "post this"; `null` means
 * "there should be nothing here, reverse anything that is"; and `undefined`
 * means "cannot tell" - which must leave the ledger untouched. Collapsing that
 * last case into `null` would turn an unreadable row into a silent reversal of
 * a perfectly good entry.
 */
function resolve(describe: () => Described, label: string): PostingDescriptor | null | undefined {
  let described: Described;
  try {
    described = describe();
  } catch (error) {
    // describe* validates before anything is written, so catching here cannot
    // leave a half-built entry behind.
    if (error instanceof AppError) {
      console.error(`[Ledger] Cannot describe ${label}: ${error.message}`);
      return undefined;
    }
    throw error;
  }
  return isSkip(described) ? null : described;
}

async function run(
  db: Db,
  label: string,
  anchor: { sourceType: string; sourceId: string },
  baseEventKey: string,
  desired: PostingDescriptor | null | undefined,
  options: SyncOptions,
): Promise<SyncResult | "unresolved"> {
  if (desired === undefined) return "unresolved";

  return syncPosting(db, {
    ...anchor,
    baseEventKey,
    desired,
    reason: options.reason ?? "source record changed",
    postedBy: options.actorId,
    // Operational postings follow the money wherever it lands, including into
    // a month that has since been closed. See the option's own comment.
    redateIfClosed: true,
  });
}

// ── Statements ──────────────────────────────────────────────────────────────

interface StatementPostings {
  label: string;
  anchor: { sourceType: string; sourceId: string };
  /** The older one-entry posting: its key, and what it would say now. */
  legacyKey: string;
  legacy: () => PostingDescriptor | null | undefined;
  /** The statement entry's key; instalment keys are derived from it. */
  statementKey: string;
  /** The statement entry and one entry per instalment. Empty when nothing should post. */
  postings: () => Array<{ key: string; desired: PostingDescriptor | null | undefined }>;
}

const baseKeyOf = (eventKey: string) => eventKey.split("#")[0]!;

/**
 * Brings a statement's postings into line: one entry for the statement, one per
 * instalment against it (see "Statements and their instalments" in events.ts).
 *
 * A statement still carrying the older one-entry posting is left exactly as it
 * is for as long as that entry is right. It moves to the split form the first
 * time it changes - the one moment the old form would have reversed it anyway -
 * so the switch costs that statement a single reversal and nothing more.
 */
async function runStatement(db: Db, plan: StatementPostings, options: SyncOptions): Promise<SyncResult | "unresolved"> {
  const live = await db.journal_entries.findMany({
    where: { source_type: plan.anchor.sourceType, source_id: plan.anchor.sourceId, status: "posted" },
    select: { event_key: true },
  });
  const liveKeys = new Set(live.map((entry) => baseKeyOf(entry.event_key)));
  const sync = (baseEventKey: string, desired: PostingDescriptor | null) =>
    syncPosting(db, {
      ...plan.anchor,
      baseEventKey,
      desired,
      reason: options.reason ?? "source record changed",
      postedBy: options.actorId,
      redateIfClosed: true,
    });

  let converted = false;
  if (liveKeys.has(plan.legacyKey)) {
    const legacy = plan.legacy();
    if (legacy === undefined) return "unresolved";
    const legacyInput = {
      ...plan.anchor,
      baseEventKey: plan.legacyKey,
      desired: legacy,
      reason: options.reason ?? "source record changed",
      postedBy: options.actorId,
      redateIfClosed: true,
    };
    if (await isPostingCurrent(db, legacyInput)) return "unchanged";

    // Only switch when every new posting can be described. Otherwise restate
    // the old way, which at least keeps the books true.
    if (plan.postings().some((posting) => posting.desired === undefined)) return syncPosting(db, legacyInput);
    await sync(plan.legacyKey, null);
    converted = true;
  }

  const postings = plan.postings();
  const wanted = new Set(postings.map((posting) => posting.key));
  const results: Array<SyncResult | "unresolved"> = [];

  for (const posting of postings) {
    if (posting.desired === undefined) {
      results.push("unresolved");
      continue;
    }
    results.push(await sync(posting.key, posting.desired));
  }

  // Instalments that no longer exist - a reverted payment - come back out.
  const prefix = instalmentKeyPrefix(plan.statementKey);
  for (const key of liveKeys) {
    if (key.startsWith(prefix) && !wanted.has(key)) results.push(await sync(key, null));
  }
  // Nothing wanted at all (a cancelled statement) still has to clear the statement entry.
  if (!wanted.has(plan.statementKey) && liveKeys.has(plan.statementKey)) {
    results.push(await sync(plan.statementKey, null));
  }

  if (results.includes("unresolved")) return "unresolved";
  return results.find((result) => result !== "unchanged" && result !== "skipped") ?? (converted ? "reposted" : "unchanged");
}

/** The statement entry, then each instalment's, as runStatement expects them. */
function statementPostings<A extends { id: string }>(
  label: string,
  statementKey: string,
  statement: () => Described,
  shares: () => A[],
  instalment: (share: A) => Described,
): Array<{ key: string; desired: PostingDescriptor | null | undefined }> {
  return [
    { key: statementKey, desired: resolve(statement, label) },
    ...shares().map((share) => ({
      key: instalmentEventKey(statementKey, share.id),
      desired: resolve(() => instalment(share), `${label} instalment ${share.id}`),
    })),
  ];
}

// ── Settlements ─────────────────────────────────────────────────────────────

const INSTALMENT_SELECT = {
  select: { id: true, amount: true, method: true, breakdown: true, paid_at: true },
} as const;

const SETTLEMENT_POSTING_SELECT = {
  id: true,
  statement_id: true,
  payee_type: true,
  rider_id: true,
  vendor_id: true,
  amount: true,
  payable_amount: true,
  payment_method: true,
  payments: true,
  paid_amount: true,
  vendor_credit_applied: true,
  settlement_date: true,
  updated_at: true,
  status: true,
  settlement_payments: INSTALMENT_SELECT,
  riders: { select: { name: true } },
  vendors: { select: { client_name: true, business_name: true } },
  // The statement's parcels, purely to split the office's cut between delivery
  // and return revenue. The *total* cut is taken from the statement itself
  // (gross minus payable), so a missing or stale item here shifts which revenue
  // account a rupee lands in - never whether the entry balances.
  // Also which vendor each item's COD belongs to, so a rider remittance can
  // credit 2005 per vendor.
  settlement_items: {
    select: {
      amount: true,
      cod_collections: {
        select: {
          vendor_id: true,
          parcels: { select: { status: true, order_type: true, delivery_charge: true } },
        },
      },
    },
  },
} as const;

/**
 * Brings a settlement's postings into line.
 *
 * A statement is the money event in this ledger - the only one on the COD side.
 * Creating it posts the statement: COD comes off the float the rider
 * remittances built up, the office's cut becomes revenue, the rest is owed to
 * the vendor. Each instalment then posts its own entry. Nothing was posted while
 * the parcels were being delivered, so there is nothing here to net against.
 *
 * Every status except `cancelled` posts. A cancelled statement moved no money
 * and reverses cleanly, as does one deleted outright.
 */
export async function syncSettlementPostings(
  db: Db,
  settlementIds: string[],
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const summary = noChange();
  const ids = Array.from(new Set(settlementIds.filter(Boolean)));
  if (ids.length === 0) return summary;

  const [settlements, methodAccounts] = await Promise.all([
    db.settlements.findMany({ where: { id: { in: ids } }, select: SETTLEMENT_POSTING_SELECT }),
    // Read once for the batch rather than per settlement, and read fresh - see
    // loadMethodAccounts for why this is not cached.
    loadMethodAccounts(db),
  ]);

  for (const row of settlements) {
    const settlement = { ...row, methodAccounts, return_charges: returnChargesOn(row), vendor_shares: vendorSharesOn(row) };
    const isRider = settlement.payee_type === "rider";
    const label = `settlement ${settlement.statement_id}`;
    const live = settlement.status !== "cancelled";
    const statementKey = isRider ? EVENT_KEY.riderStatement : EVENT_KEY.vendorStatement;
    const payable = new Decimal(settlement.payable_amount ?? settlement.amount);

    record(
      summary,
      await runStatement(
        db,
        {
          label,
          anchor: SOURCE.settlement(settlement.id),
          legacyKey: isRider ? EVENT_KEY.riderRemittance : EVENT_KEY.vendorSettlement,
          legacy: () =>
            live
              ? resolve(() => (isRider ? describeRiderRemittance(settlement) : describeVendorSettlement(settlement)), label)
              : null,
          statementKey,
          postings: () =>
            live
              ? statementPostings(
                  label,
                  statementKey,
                  () => (isRider ? describeRiderStatement(settlement) : describeVendorStatement(settlement)),
                  () =>
                    allocateInstalments(
                      settlement,
                      settlement.settlement_payments,
                      isRider ? payable : payable.abs(),
                      settlement.settlement_date ?? settlement.updated_at,
                    ),
                  (share) => (isRider ? describeRiderInstalment(settlement, share) : describeVendorInstalment(settlement, share)),
                )
              : [],
        },
        options,
      ),
    );
  }

  return summary;
}

/** How much of a statement's withheld charges came from return legs. */
function returnChargesOn(settlement: {
  settlement_items: Array<{
    cod_collections: { parcels: { status: string; order_type: string; delivery_charge: Prisma.Decimal } | null } | null;
  }>;
}): Prisma.Decimal {
  return settlement.settlement_items.reduce((total, item) => {
    const parcel = item.cod_collections?.parcels;
    if (!parcel || !isReturnLeg(parcel)) return total;
    return total.plus(parcel.delivery_charge ?? 0);
  }, new Decimal(0));
}

/** A statement's COD summed per vendor, so 2005 can be credited to each one. */
function sharesByVendor(items: Array<{ vendorId: string | null | undefined; amount: Prisma.Decimal }>) {
  const byVendor = new Map<string, Prisma.Decimal>();
  for (const { vendorId, amount } of items) {
    if (!vendorId) continue;
    byVendor.set(vendorId, (byVendor.get(vendorId) ?? new Decimal(0)).plus(amount));
  }
  return Array.from(byVendor, ([vendorId, amount]) => ({ vendorId, amount }));
}

const vendorSharesOn = (settlement: {
  settlement_items: Array<{ amount: Prisma.Decimal; cod_collections: { vendor_id: string | null } | null }>;
}) => sharesByVendor(settlement.settlement_items.map((item) => ({ vendorId: item.cod_collections?.vendor_id, amount: item.amount })));

// ── Branch settlements ──────────────────────────────────────────────────────

/**
 * Brings a branch COD statement's postings into line.
 *
 * Posts the statement on creation and one entry per instalment, mirroring vendor
 * statements. A cancelled statement moved no money and reverses.
 */
export async function syncBranchSettlementPostings(
  db: Db,
  settlementIds: string[],
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const summary = noChange();
  const ids = Array.from(new Set(settlementIds.filter(Boolean)));
  if (ids.length === 0) return summary;

  const [rows, methodAccounts] = await Promise.all([
    db.branch_settlements.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        statement_no: true,
        from_branch_id: true,
        to_branch_id: true,
        gross_cod: true,
        commission_amount: true,
        net_payable: true,
        paid_amount: true,
        payment_method: true,
        payments: true,
        settlement_date: true,
        status: true,
        payment_records: INSTALMENT_SELECT,
        from_branch: { select: { name: true } },
      },
    }),
    loadMethodAccounts(db),
  ]);

  for (const row of rows) {
    const settlement = { ...row, methodAccounts };
    const label = `branch settlement ${settlement.statement_no}`;
    const live = settlement.status !== "cancelled";
    record(
      summary,
      await runStatement(
        db,
        {
          label,
          anchor: SOURCE.branchSettlement(settlement.id),
          legacyKey: EVENT_KEY.branchSettlement,
          legacy: () => (live ? resolve(() => describeBranchSettlement(settlement), label) : null),
          statementKey: EVENT_KEY.branchStatement,
          postings: () =>
            live
              ? statementPostings(
                  label,
                  EVENT_KEY.branchStatement,
                  () => describeBranchStatement(settlement),
                  () =>
                    allocateInstalments(
                      settlement,
                      settlement.payment_records,
                      new Decimal(settlement.net_payable),
                      settlement.settlement_date,
                    ),
                  (share) => describeBranchInstalment(settlement, share),
                )
              : [],
        },
        options,
      ),
    );
  }

  return summary;
}

// ── 3PL carrier settlements ─────────────────────────────────────────────────

/** Same lifecycle as branch statements: the statement on creation, an entry per instalment, a cancelled one reverses. */
export async function syncCarrierSettlementPostings(
  db: Db,
  settlementIds: string[],
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const summary = noChange();
  const ids = Array.from(new Set(settlementIds.filter(Boolean)));
  if (ids.length === 0) return summary;

  const [rows, methodAccounts] = await Promise.all([
    db.carrier_settlements.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        statement_no: true,
        carrier_code: true,
        gross_cod: true,
        carrier_charges: true,
        net_receivable: true,
        paid_amount: true,
        payment_method: true,
        payments: true,
        settlement_date: true,
        status: true,
        payment_records: INSTALMENT_SELECT,
        items: { select: { collected_amount: true, cod_collection: { select: { vendor_id: true } } } },
      },
    }),
    loadMethodAccounts(db),
  ]);

  for (const row of rows) {
    const vendor_shares = sharesByVendor(
      row.items.map((item) => ({ vendorId: item.cod_collection.vendor_id, amount: item.collected_amount })),
    );
    const settlement = { ...row, methodAccounts, vendor_shares };
    const label = `carrier settlement ${settlement.statement_no}`;
    const live = settlement.status !== "cancelled";
    record(
      summary,
      await runStatement(
        db,
        {
          label,
          anchor: SOURCE.carrierSettlement(settlement.id),
          legacyKey: EVENT_KEY.carrierSettlement,
          legacy: () => (live ? resolve(() => describeCarrierSettlement(settlement), label) : null),
          statementKey: EVENT_KEY.carrierStatement,
          postings: () =>
            live
              ? statementPostings(
                  label,
                  EVENT_KEY.carrierStatement,
                  () => describeCarrierStatement(settlement),
                  () =>
                    allocateInstalments(
                      settlement,
                      settlement.payment_records,
                      new Decimal(settlement.net_receivable),
                      settlement.settlement_date,
                    ),
                  (share) => describeCarrierInstalment(settlement, share),
                )
              : [],
        },
        options,
      ),
    );
  }

  return summary;
}

// ── Vendor payments ─────────────────────────────────────────────────────────

/**
 * Brings a vendor payment's posting into line.
 *
 * Only a `verified` payment posts. A claim that is still pending, or one an
 * admin later rejects, must move nothing - the same rule that stops a blocked
 * vendor unblocking themselves by claiming a payment they never made. A
 * verification that is subsequently reversed to `rejected` reverses the entry.
 */
export async function syncVendorPaymentPostings(
  db: Db,
  paymentIds: string[],
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const summary = noChange();
  const ids = Array.from(new Set(paymentIds.filter(Boolean)));
  if (ids.length === 0) return summary;

  const [rows, methodAccounts] = await Promise.all([
    db.vendor_payments.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      vendor_id: true,
      amount: true,
      method: true,
      reference: true,
      reviewed_at: true,
      created_at: true,
      status: true,
      vendors: { select: { client_name: true, business_name: true } },
    },
    }),
    loadMethodAccounts(db),
  ]);
  const payments = rows.map((row) => ({ ...row, methodAccounts }));

  for (const payment of payments) {
    const desired =
      payment.status === "verified"
        ? resolve(() => describeVendorPaymentVerified(payment), `vendor payment ${payment.id}`)
        : null;

    record(
      summary,
      await run(db, "vendor payment", SOURCE.vendorPayment(payment.id), EVENT_KEY.vendorPayment, desired, options),
    );
  }

  return summary;
}

// ── Expenses ────────────────────────────────────────────────────────────────

/**
 * Brings an expense's posting into line.
 *
 * A `recorded` expense posts; voiding one reverses it. The expense row is
 * mutable and the entry is not, which is the whole reason the row exists - it
 * gives a human something to void, and this turns that into the reversal the
 * books require.
 */
export async function syncExpensePostings(
  db: Db,
  expenseIds: string[],
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const summary = noChange();
  const ids = Array.from(new Set(expenseIds.filter(Boolean)));
  if (ids.length === 0) return summary;

  const expenses = await db.expenses.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      expense_no: true,
      expense_date: true,
      amount: true,
      payee: true,
      note: true,
      location_id: true,
      party_type: true,
      party_id: true,
      status: true,
      account: { select: { code: true } },
      paid_from: { select: { code: true } },
    },
  });

  for (const expense of expenses) {
    const desired = resolve(() => describeExpense(expense), `expense ${expense.expense_no}`);
    record(summary, await run(db, "expense", SOURCE.expense(expense.id), EVENT_KEY.expense, desired, options));
  }

  return summary;
}

// ── Fire-and-forget ─────────────────────────────────────────────────────────

/**
 * Runs a sync outside the caller's transaction, swallowing any failure.
 *
 * Rule 1 of this file, made concrete. Used where a posting is genuinely
 * secondary to the operation - a bulk status scan of two hundred parcels should
 * not be rolled back because one of them has an unreadable COD row.
 *
 * The cost is a window where the operational row is committed and the entry is
 * not. sweepParcelPostings below closes it on a timer, and reconcile-ledger.ts
 * proves independently that it stayed closed. Prefer the in-transaction form
 * wherever the volume allows.
 */
export function syncInBackground(work: () => Promise<unknown>, label: string): void {
  void work().catch((error) => {
    console.error(`[Ledger] Background posting failed (${label}):`, error);
  });
}


// ── The sweep that closes the window ────────────────────────────────────────

/** Statements per sync call. Small enough that one bad row costs little. */
const SWEEP_CHUNK = 25;

export interface SweepResult {
  considered: number;
  /** Entries written, reversed or restated - i.e. gaps the live path left. */
  repaired: number;
  /** Statements the sweep could not settle: an unreadable row, or a chunk that threw. */
  failed: number;
}

/**
 * Re-syncs recently-touched statements, catching anything a live path dropped.
 *
 * The failure this exists for is not a crashed transaction - it is a mutator
 * that forgets to call syncSettlementPostings at all. revertSettlement did
 * exactly that, and because the old sweep only looked at parcels, nothing ever
 * noticed. So the candidates come from `updated_at` on the settlements table
 * rather than from any list of call sites: a statement that changed gets
 * re-synced whether or not the code that changed it remembered to ask.
 *
 * Deliberately not a drift *detector*. Working out in SQL which statements
 * ought to have an entry would mean restating the rules that already live in
 * events.ts, and two copies of a money rule is how a ledger starts lying.
 * Instead it re-runs the authority over a bounded window: syncPosting compares
 * what is posted against what should be and answers "unchanged" for everything
 * already correct, so a sweep over healthy data writes nothing.
 *
 * No status filter, deliberately. A statement moving *out* of settled needs its
 * entry reversed, which means the sweep has to see it.
 *
 * Bounded twice over - by the window and by `limit` - because this runs on a
 * timer and an unbounded sweep is a self-inflicted outage waiting for a busy day.
 */
export async function sweepSettlementPostings(
  options: { since: Date; limit: number } = { since: new Date(Date.now() - 60 * 60 * 1000), limit: 500 },
): Promise<SweepResult> {
  const window = { where: { updated_at: { gte: options.since } }, select: { id: true }, orderBy: { updated_at: "asc" as const }, take: options.limit };
  const [statements, branchStatements, carrierStatements] = await Promise.all([
    prisma.settlements.findMany(window),
    prisma.branch_settlements.findMany(window),
    prisma.carrier_settlements.findMany(window),
  ]);

  const vendorAndRider = await sweepChunks(statements.map((row) => row.id), syncSettlementPostings, "statement");
  const branch = await sweepChunks(branchStatements.map((row) => row.id), syncBranchSettlementPostings, "branch statement");
  const carrier = await sweepChunks(carrierStatements.map((row) => row.id), syncCarrierSettlementPostings, "carrier statement");
  return {
    considered: statements.length + branchStatements.length + carrierStatements.length,
    repaired: vendorAndRider.repaired + branch.repaired + carrier.repaired,
    failed: vendorAndRider.failed + branch.failed + carrier.failed,
  };
}

async function sweepChunks(
  ids: string[],
  sync: (db: Db, ids: string[], options: SyncOptions) => Promise<SyncSummary>,
  noun: string,
): Promise<Omit<SweepResult, "considered">> {
  let repaired = 0;
  let failed = 0;

  for (let index = 0; index < ids.length; index += SWEEP_CHUNK) {
    const chunk = ids.slice(index, index + SWEEP_CHUNK);
    try {
      // In a transaction, and this is not optional. The balance trigger is
      // DEFERRABLE INITIALLY DEFERRED, which defers it to the end of the
      // enclosing transaction - and with no enclosing transaction that means
      // the end of the INSERT's own implicit one, before a single line has been
      // written. Every posting would fail with "0 lines".
      //
      // The sync already knows what it changed, so the sweep asks it rather
      // than counting entries either side of the call - two queries per chunk
      // to rediscover a number that was in hand.
      const summary = await prisma.$transaction(
        (tx) => sync(tx, chunk, { reason: "ledger sweep" }),
        { timeout: 120_000, maxWait: 30_000 },
      );
      repaired += summary.changed;
      failed += summary.unresolved;
    } catch (error) {
      failed += chunk.length;
      console.error(`[Ledger] Sweep chunk failed (${chunk.length} ${noun}(s)):`, error);
    }
  }

  return { repaired, failed };
}
