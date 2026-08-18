// The posting engine: the only supported way to write to the ledger.
//
// Every function here takes the caller's transaction client rather than
// reaching for the global prisma singleton. That is the whole point of the
// design: a money event writes its operational rows and posts its journal entry
// in ONE transaction, so there is no window in which the two disagree and no
// failure mode where the ledger is half-written.
//
// Three invariants are enforced here as well as in the database:
//   1. Balance      - debits equal credits, at the stored 2dp scale.
//   2. Idempotency  - one economic event posts at most one entry, ever.
//   3. Period lock  - nothing lands in a closed BS month.
//
// The database enforces (1) and (3) too (a trigger and an FK). This layer
// exists to fail with a message that says what the caller did wrong, and to
// make (2) cheap.
import { Prisma } from "../../generated/prisma/client";
import { journal_entry_status, ledger_party_type } from "../../generated/prisma/enums";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { bsMonthRange, bsPeriodKey, fiscalYearOf, formatBs, parsePeriodKey } from "../../utils/bikramSambat";
import { resolveAccounts } from "./accounts";

type Db = Prisma.TransactionClient | typeof prisma;

/** Money as it arrives from Prisma Decimal columns, raw SQL strings or plain numbers. */
export type Amount = Prisma.Decimal | number | string;

export interface JournalLineInput {
  accountCode: string;
  /** Exactly one of debit/credit must be non-zero. */
  debit?: Amount | undefined;
  credit?: Amount | undefined;
  party?: { type: ledger_party_type; id: string } | undefined;
  locationId?: string | null | undefined;
  parcelId?: string | null | undefined;
  memo?: string | null | undefined;
}

export interface PostJournalInput {
  /** When the economic event happened. Decides the BS period, so it is not "now". */
  entryDate: Date;
  memo?: string | null | undefined;
  /** cod_collection | parcel | settlement | vendor_payment | opening_balance | manual | reversal */
  sourceType: string;
  sourceId?: string | null | undefined;
  /** Distinguishes multiple entries off one source row. */
  eventKey: string;
  postedBy?: string | null | undefined;
  lines: JournalLineInput[];
  /**
   * Post even if the target period is closed.
   *
   * Set only for automated postings driven by operational events, and it is the
   * difference between a period lock and a business outage. The lock exists to
   * stop a *human* backdating into filed books. A delivery is not backdating -
   * it is a thing that happened - and if closing a month could refuse it, the
   * parcel scan itself would fail.
   *
   * Callers pair this with a redate, so an automated entry lands in an open
   * period whenever one exists and only falls back to a closed one when every
   * candidate is shut. Manual entries never set it, so a person backdating into
   * a closed period is still told no.
   */
  allowClosedPeriod?: boolean | undefined;
}

export interface PostJournalResult {
  id: string;
  entryNo: string;
  periodKey: string;
  /** False when this event was already posted - the call was a no-op. */
  created: boolean;
}

/** Returned instead of an entry when every line came out as zero. */
export interface SkippedPosting {
  skipped: true;
  reason: string;
}

export type PostOutcome = (PostJournalResult & { skipped?: false }) | SkippedPosting;

export function wasPosted(outcome: PostOutcome): outcome is PostJournalResult & { skipped?: false } {
  return !("skipped" in outcome && outcome.skipped);
}

// Money is DECIMAL(14,2) in the ledger. Normalising every input to that scale
// *before* the balance check is what makes the check meaningful: two amounts
// that agree at four decimal places but round apart at two would otherwise pass
// here and then fail the database trigger at COMMIT, a long way from the code
// that caused it.
const SCALE = 2;

function toAmount(value: Amount | undefined): Prisma.Decimal {
  if (value === undefined || value === null) return new Prisma.Decimal(0);
  return new Prisma.Decimal(value).toDecimalPlaces(SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

// ── Periods ─────────────────────────────────────────────────────────────────

/**
 * Makes sure the BS month an entry lands in exists, and returns its status.
 *
 * Created on demand rather than pre-seeded forever forward, so the books grow a
 * month at a time as they are actually used. ON CONFLICT DO NOTHING because two
 * concurrent postings on the first day of a month will race here, and both
 * should simply proceed.
 */
export async function ensurePeriod(db: Db, date: Date): Promise<{ periodKey: string; isOpen: boolean }> {
  const periodKey = bsPeriodKey(date);
  const { year, month } = parsePeriodKey(periodKey);

  const existing = await db.accounting_periods.findUnique({
    where: { period_key: periodKey },
    select: { status: true },
  });
  if (existing) return { periodKey, isOpen: existing.status === "open" };

  const { start, end } = bsMonthRange(year, month);
  const fiscal = fiscalYearOf(start);

  await db.$executeRaw`
    INSERT INTO accounting_periods (period_key, fiscal_year, bs_year, bs_month, starts_at, ends_at)
    VALUES (${periodKey}, ${fiscal.code}, ${year}, ${month}, ${start}, ${end})
    ON CONFLICT (period_key) DO NOTHING
  `;

  // Re-read rather than assuming: if the race above was lost, the winner's row
  // is the one that counts, and it could in principle already be closed.
  const created = await db.accounting_periods.findUnique({
    where: { period_key: periodKey },
    select: { status: true },
  });
  return { periodKey, isOpen: (created?.status ?? "open") === "open" };
}

// ── Posting ─────────────────────────────────────────────────────────────────

/**
 * Posts one balanced journal entry.
 *
 * Idempotent on (sourceType, sourceId, eventKey): calling it twice for the same
 * economic event returns the original entry with `created: false` and writes
 * nothing. That is what makes a retried request, a replayed webhook or a
 * re-run backfill safe.
 */
export async function postJournal(db: Db, input: PostJournalInput): Promise<PostOutcome> {
  // Drop zero-value lines before anything else. They are a normal outcome of
  // real data (a settlement whose payable nets to exactly zero, a parcel with
  // no delivery charge), the schema forbids storing them, and dropping them
  // cannot unbalance an entry that was balanced.
  const lines = input.lines
    .map((line) => ({ ...line, debitAmount: toAmount(line.debit), creditAmount: toAmount(line.credit) }))
    .filter((line) => !line.debitAmount.isZero() || !line.creditAmount.isZero());

  if (lines.length === 0) {
    return { skipped: true, reason: "every line was zero" };
  }

  for (const line of lines) {
    if (line.debitAmount.isNegative() || line.creditAmount.isNegative()) {
      throw new AppError(
        400,
        `Journal line on ${line.accountCode} has a negative amount. Post the opposite side instead of a negative one.`,
      );
    }
    if (!line.debitAmount.isZero() && !line.creditAmount.isZero()) {
      throw new AppError(400, `Journal line on ${line.accountCode} carries both a debit and a credit`);
    }
  }

  const debitTotal = lines.reduce((sum, line) => sum.plus(line.debitAmount), new Prisma.Decimal(0));
  const creditTotal = lines.reduce((sum, line) => sum.plus(line.creditAmount), new Prisma.Decimal(0));
  if (!debitTotal.equals(creditTotal)) {
    throw new AppError(
      400,
      `Journal entry does not balance: debits ${debitTotal.toFixed(SCALE)}, credits ${creditTotal.toFixed(SCALE)}`,
    );
  }
  if (lines.length < 2) {
    throw new AppError(400, "A journal entry needs at least two lines");
  }

  const accounts = await resolveAccounts(db, lines.map((line) => line.accountCode));

  for (const line of lines) {
    const account = accounts.get(line.accountCode)!;
    // A control account's balance is only meaningful per party; an untagged
    // line would land in its total but in nobody's subledger, and the two would
    // silently stop reconciling.
    if (account.isControl) {
      if (!line.party) {
        throw new AppError(400, `Account ${line.accountCode} is a control account and requires a party`);
      }
      if (line.party.type !== account.subledgerType) {
        throw new AppError(
          400,
          `Account ${line.accountCode} keeps a ${account.subledgerType} subledger, but the line names a ${line.party.type}`,
        );
      }
    }
  }

  const { periodKey, isOpen } = await ensurePeriod(db, input.entryDate);
  if (!isOpen && !input.allowClosedPeriod) {
    throw new AppError(
      409,
      `Accounting period ${periodKey} is closed. Post the correction into an open period instead.`,
    );
  }

  // Check before inserting so the common (non-duplicate) path does not burn a
  // voucher number on a row that will be discarded. The ON CONFLICT below is
  // still required - this read does not lock anything, and two concurrent
  // posts of the same event would both get here.
  const alreadyPosted = await db.journal_entries.findFirst({
    where: { source_type: input.sourceType, source_id: input.sourceId ?? null, event_key: input.eventKey },
    select: { id: true, entry_no: true, period_key: true },
  });
  if (alreadyPosted) {
    return { id: alreadyPosted.id, entryNo: alreadyPosted.entry_no, periodKey: alreadyPosted.period_key, created: false };
  }

  const fiscal = fiscalYearOf(input.entryDate);
  const inserted = await db.$queryRaw<Array<{ id: string; entry_no: string }>>`
    INSERT INTO journal_entries (
      entry_no, entry_date, bs_date, period_key, memo, source_type, source_id, event_key, posted_by
    )
    VALUES (
      ${`JE-${fiscal.startYear}-`} || lpad(nextval('journal_entry_no_seq')::text, 6, '0'),
      ${input.entryDate},
      ${formatBs(input.entryDate)},
      ${periodKey},
      ${input.memo ?? null},
      ${input.sourceType},
      ${input.sourceId ?? null}::uuid,
      ${input.eventKey},
      ${input.postedBy ?? null}::uuid
    )
    ON CONFLICT (source_type, source_id, event_key) DO NOTHING
    RETURNING id, entry_no
  `;

  // Lost the race: the other transaction posted this exact event. Its entry is
  // the one that counts, so report it rather than posting a duplicate.
  //
  // Note this only happens once the other transaction has COMMITTED - if it is
  // still open, ON CONFLICT blocks until it resolves, which is exactly the
  // serialisation wanted here.
  if (inserted.length === 0) {
    const winner = await db.journal_entries.findFirstOrThrow({
      where: { source_type: input.sourceType, source_id: input.sourceId ?? null, event_key: input.eventKey },
      select: { id: true, entry_no: true, period_key: true },
    });
    return { id: winner.id, entryNo: winner.entry_no, periodKey: winner.period_key, created: false };
  }

  const entry = inserted[0]!;

  await db.journal_lines.createMany({
    data: lines.map((line, index) => ({
      entry_id: entry.id,
      line_no: index + 1,
      account_id: accounts.get(line.accountCode)!.id,
      debit: line.debitAmount,
      credit: line.creditAmount,
      party_type: line.party?.type ?? null,
      party_id: line.party?.id ?? null,
      location_id: line.locationId ?? null,
      parcel_id: line.parcelId ?? null,
      memo: line.memo ?? null,
      entry_date: input.entryDate,
    })),
  });

  return { id: entry.id, entryNo: entry.entry_no, periodKey, created: true };
}

// ── Reversal ────────────────────────────────────────────────────────────────

export interface ReverseJournalInput {
  /** The entry to undo. */
  entryId: string;
  reason: string;
  postedBy?: string | null | undefined;
  /**
   * When to book the reversal. Defaults to the original's date, which keeps the
   * correction in the month it belongs to - but that month may be closed, in
   * which case the caller must pass a date in an open period.
   */
  entryDate?: Date | undefined;
  /** See PostJournalInput.allowClosedPeriod. Set by automated syncs only. */
  allowClosedPeriod?: boolean | undefined;
}

/**
 * Undoes a posted entry by posting its mirror image and marking the original
 * `voided`.
 *
 * This is the only way to take back a posting. Editing or deleting the original
 * is blocked by the database, and rightly: the fact that the office believed
 * something on a given day is itself part of the record.
 */
export async function reverseJournal(db: Db, input: ReverseJournalInput): Promise<PostOutcome> {
  const original = await db.journal_entries.findUnique({
    where: { id: input.entryId },
    include: { lines: { include: { account: { select: { code: true } } } }, },
  });
  if (!original) {
    throw new AppError(404, "Journal entry not found");
  }
  if (original.status === journal_entry_status.voided) {
    throw new AppError(400, `Journal entry ${original.entry_no} has already been reversed`);
  }

  const reversal = await postJournal(db, {
    entryDate: input.entryDate ?? original.entry_date,
    memo: `Reversal of ${original.entry_no}: ${input.reason}`,
    sourceType: "reversal",
    // Sourcing the reversal on the original's id means the idempotency index
    // doubles as the "reverse only once" guard - no extra check needed.
    sourceId: original.id,
    eventKey: "reversal",
    postedBy: input.postedBy ?? null,
    allowClosedPeriod: input.allowClosedPeriod,
    lines: original.lines.map((line) => ({
      accountCode: line.account.code,
      // The mirror image: every debit becomes a credit and vice versa.
      debit: line.credit,
      credit: line.debit,
      party:
        line.party_type && line.party_id ? { type: line.party_type, id: line.party_id } : undefined,
      locationId: line.location_id,
      parcelId: line.parcel_id,
      memo: line.memo,
    })),
  });

  if (wasPosted(reversal) && reversal.created) {
    await db.journal_entries.update({
      where: { id: original.id },
      data: { status: journal_entry_status.voided },
    });
    await db.journal_entries.update({
      where: { id: reversal.id },
      data: { reversal_of_id: original.id },
    });
  }

  return reversal;
}

// ── Sync ────────────────────────────────────────────────────────────────────

export interface SyncPostingInput {
  sourceType: string;
  sourceId: string;
  /** Stable key for this posting's role, e.g. `cod_collected`. */
  baseEventKey: string;
  /** What the ledger *should* say now. Null means "this posting should not exist". */
  desired: { entryDate: Date; memo?: string | null; lines: JournalLineInput[] } | null;
  reason: string;
  postedBy?: string | null | undefined;
  /**
   * Book into the current period when the event's own period is closed,
   * instead of refusing.
   *
   * On for automated postings driven by operational events. A closed month must
   * not be able to block a delivery from being recorded, and the accounting
   * answer to "this belongs in a month that is shut" is not "refuse" - it is
   * "book it in the open month", which is what an accountant does with a late
   * invoice. Manual entries leave this off, so a human backdating into a closed
   * period gets told no.
   */
  redateIfClosed?: boolean | undefined;
}

export type SyncResult = "unchanged" | "posted" | "reversed" | "reposted" | "skipped";

/** Comparable shape of a posting, for deciding whether anything actually changed. */
function fingerprint(lines: Array<{ code: string; debit: string; credit: string; party: string | null }>): string {
  return lines
    .map((line) => `${line.code}|${line.debit}|${line.credit}|${line.party ?? ""}`)
    .sort()
    .join(";");
}

/**
 * Converges one posting to what the source data now says, whatever state it is
 * currently in.
 *
 * This is the difference between a ledger that survives contact with a real
 * operations system and one that does not. Money events here are not
 * write-once: a delivery can be un-delivered, a COD amount corrected, a
 * statement's order list edited, a parcel soft-deleted. Firing a post on each
 * of those transitions means enumerating every path that could ever change a
 * number, and quietly drifting the day one is missed.
 *
 * So callers do not describe the transition; they describe the destination.
 * This function works out whether that means posting for the first time,
 * reversing what is there, or reversing and re-posting - and does nothing at
 * all when the ledger already agrees, which is the common case.
 *
 * Corrections are versioned (`cod_collected`, then `cod_collected#2`, ...) so
 * the idempotency index still guards each individual posting while leaving room
 * for a genuine restatement. Every superseded version stays in the books as a
 * voided entry paired with its reversal.
 */
export async function syncPosting(db: Db, input: SyncPostingInput): Promise<SyncResult> {
  const history = await db.journal_entries.findMany({
    where: {
      source_type: input.sourceType,
      source_id: input.sourceId,
      OR: [{ event_key: input.baseEventKey }, { event_key: { startsWith: `${input.baseEventKey}#` } }],
    },
    include: { lines: { include: { account: { select: { code: true } } } } },
    orderBy: { created_at: "asc" },
  });

  const active = history.find((entry) => entry.status === journal_entry_status.posted);

  // Normalise the desired lines the same way postJournal will, so the
  // comparison below is against what would actually be stored - not against
  // what the caller happened to pass in.
  const desiredLines = (input.desired?.lines ?? [])
    .map((line) => ({
      code: line.accountCode,
      debit: toAmount(line.debit).toFixed(SCALE),
      credit: toAmount(line.credit).toFixed(SCALE),
      party: line.party?.id ?? null,
    }))
    .filter((line) => line.debit !== "0.00" || line.credit !== "0.00");

  const wantsPosting = Boolean(input.desired) && desiredLines.length > 0;

  if (!wantsPosting) {
    if (!active) return "unchanged";
    await reverseActive(db, active, input);
    return "reversed";
  }

  if (active) {
    const currentLines = active.lines.map((line) => ({
      code: line.account.code,
      debit: line.debit.toFixed(SCALE),
      credit: line.credit.toFixed(SCALE),
      party: line.party_id,
    }));
    const sameMoney = fingerprint(currentLines) === fingerprint(desiredLines);

    // Compared by accounting period, not by exact timestamp, and that
    // distinction matters more than it looks.
    //
    // Re-scanning an already-delivered parcel rewrites cod_collections.
    // collected_at to "now". Nothing about the money changed, but an exact
    // timestamp comparison would call that a restatement and churn out a
    // reversal plus a fresh posting on every duplicate scan - filling the
    // journal with pairs that cancel each other and say nothing.
    //
    // What actually has to be right is which month the amount lands in. If it
    // still lands in the same period, leave it alone.
    const samePeriod = active.period_key === bsPeriodKey(input.desired!.entryDate);
    if (sameMoney && samePeriod) return "unchanged";

    await reverseActive(db, active, input);
  }

  // Version the key so the restatement is a new, separately-idempotent posting
  // rather than one blocked by the original's unique row.
  const version = history.length + 1;
  const eventKey = version === 1 ? input.baseEventKey : `${input.baseEventKey}#${version}`;

  const { entryDate, memo } = await resolvePostingDate(db, input.desired!.entryDate, input.desired!.memo ?? null, input.redateIfClosed);

  const outcome = await postJournal(db, {
    entryDate,
    memo,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    eventKey,
    postedBy: input.postedBy,
    lines: input.desired!.lines,
    // The redate above moves the entry to an open period when one exists. This
    // covers the remaining case - every candidate period closed - where the
    // choice is between a slightly untidy entry and a failed parcel scan.
    allowClosedPeriod: input.redateIfClosed,
  });

  if (!wasPosted(outcome)) return "skipped";
  return active ? "reposted" : "posted";
}

/**
 * Moves a posting into the current period if its own period is closed.
 *
 * The shift is recorded in the memo. An entry silently sitting on a date other
 * than the one its event happened is the kind of thing that costs an hour to
 * work out later; saying so on the entry costs nothing.
 */
async function resolvePostingDate(
  db: Db,
  preferred: Date,
  memo: string | null,
  redateIfClosed: boolean | undefined,
): Promise<{ entryDate: Date; memo: string | null }> {
  if (!redateIfClosed) return { entryDate: preferred, memo };

  const { isOpen } = await ensurePeriod(db, preferred);
  if (isOpen) return { entryDate: preferred, memo };

  const now = new Date();
  const note = `originally dated ${formatBs(preferred)}, booked here because that period is closed`;
  return { entryDate: now, memo: memo ? `${memo} (${note})` : note };
}

/**
 * Reverses the currently-active version.
 *
 * The reversal is booked on the original's own date so the correction lands in
 * the month it belongs to - unless that month is already closed, in which case
 * it goes into the period the new posting is destined for. Refusing outright
 * would be worse: it would make a closed period able to block an ordinary
 * operational change, like un-delivering a parcel.
 */
async function reverseActive(
  db: Db,
  active: { id: string; entry_date: Date; period_key: string },
  input: SyncPostingInput,
): Promise<void> {
  const period = await db.accounting_periods.findUnique({
    where: { period_key: active.period_key },
    select: { status: true },
  });

  const originalPeriodOpen = (period?.status ?? "open") === "open";
  const reversalDate = originalPeriodOpen ? active.entry_date : (input.desired?.entryDate ?? new Date());

  await reverseJournal(db, {
    entryId: active.id,
    reason: input.reason,
    postedBy: input.postedBy,
    entryDate: reversalDate,
    // An automated correction must be able to undo itself even when every
    // candidate period is shut, for the same reason it must be able to post.
    allowClosedPeriod: input.redateIfClosed,
  });
}

/**
 * Reverses every posted entry produced by a source row.
 *
 * Used when an operational record is corrected after the fact - editing an
 * unsettled statement, for instance - where the honest sequence is "undo what
 * was posted, then post what is true now" rather than a silent adjustment.
 */
export async function reverseEntriesForSource(
  db: Db,
  sourceType: string,
  sourceId: string,
  options: { reason: string; postedBy?: string | null; entryDate?: Date },
): Promise<number> {
  const entries = await db.journal_entries.findMany({
    where: { source_type: sourceType, source_id: sourceId, status: journal_entry_status.posted },
    select: { id: true },
  });

  for (const entry of entries) {
    await reverseJournal(db, {
      entryId: entry.id,
      reason: options.reason,
      postedBy: options.postedBy,
      entryDate: options.entryDate,
    });
  }

  return entries.length;
}
