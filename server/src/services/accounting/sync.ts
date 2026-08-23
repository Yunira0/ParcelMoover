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
  describeExpense,
  describeRiderRemittance,
  describeVendorPaymentVerified,
  describeVendorSettlement,
  EVENT_KEY,
  isSkip,
  SOURCE,
  type Described,
  type PostingDescriptor,
} from "./events";
import { loadMethodAccounts } from "./accounts";
import { syncPosting, type SyncResult } from "./posting.service";
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

// ── Settlements ─────────────────────────────────────────────────────────────

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
  settlement_date: true,
  updated_at: true,
  status: true,
  riders: { select: { name: true } },
  vendors: { select: { client_name: true, business_name: true } },
  // The statement's parcels, purely to split the office's cut between delivery
  // and return revenue. The *total* cut is taken from the statement itself
  // (gross minus payable), so a missing or stale item here shifts which revenue
  // account a rupee lands in - never whether the entry balances.
  settlement_items: {
    select: {
      cod_collections: {
        select: { parcels: { select: { status: true, order_type: true, delivery_charge: true } } },
      },
    },
  },
} as const;

/**
 * Brings a settlement's posting into line.
 *
 * A statement is the money event in this ledger - the only one on the COD side.
 * Creating it posts the whole cycle at once: COD comes off the float the rider
 * remittances built up, the office's cut becomes revenue, the rest goes to the
 * vendor. Nothing was posted while the parcels were being delivered, so there
 * is nothing here to net against.
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
    const settlement = { ...row, methodAccounts, return_charges: returnChargesOn(row) };
    const isRider = settlement.payee_type === "rider";
    const eventKey = isRider ? EVENT_KEY.riderRemittance : EVENT_KEY.vendorSettlement;
    const label = `settlement ${settlement.statement_id}`;

    const desired =
      settlement.status !== "cancelled"
        ? resolve(
            () => (isRider ? describeRiderRemittance(settlement) : describeVendorSettlement(settlement)),
            label,
          )
        : null;

    record(summary, await run(db, label, SOURCE.settlement(settlement.id), eventKey, desired, options));
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
  const candidates = await prisma.settlements.findMany({
    where: { updated_at: { gte: options.since } },
    select: { id: true },
    orderBy: { updated_at: "asc" },
    take: options.limit,
  });

  let repaired = 0;
  let failed = 0;

  for (let index = 0; index < candidates.length; index += SWEEP_CHUNK) {
    const chunk = candidates.slice(index, index + SWEEP_CHUNK).map((settlement) => settlement.id);
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
        (tx) => syncSettlementPostings(tx, chunk, { reason: "ledger sweep" }),
        { timeout: 120_000, maxWait: 30_000 },
      );
      repaired += summary.changed;
      failed += summary.unresolved;
    } catch (error) {
      failed += chunk.length;
      console.error(`[Ledger] Sweep chunk failed (${chunk.length} statement(s)):`, error);
    }
  }

  return { considered: candidates.length, repaired, failed };
}
