// Read and write API for the books.
//
// The posting engine decides what the ledger says; this decides how to ask.
// Two things shape most of what follows.
//
// First, every report is a query over journal_lines with a date window and a
// grouping - trial balance, P&L, balance sheet, an account ledger and a party
// subledger are the same shape with different filters. They share
// accountTotals() rather than each growing its own SQL.
//
// Second, direction. Debits and credits are neutral in the database; a reader
// wants "how much do we owe this vendor", not "the credit side exceeds the
// debit side by". Every balance leaving this file is therefore signed on its
// account's own normal side, so a positive number always means what the account
// is for - cash held, money owed, revenue earned.
import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
  bsMonthRange,
  BS_MONTH_NAMES,
  bsPeriodKey,
  fiscalYear,
  fiscalYearOf,
  formatBs,
  parsePeriodKey,
} from "../../utils/bikramSambat";
import type {
  AccountBalance,
  AccountLedger,
  AccountSummary,
  AccountingOverview,
  BalanceSheet,
  CreateExpenseInput,
  CreateManualEntryInput,
  DateRange,
  ExpenseView,
  JournalEntryView,
  LedgerRow,
  Paged,
  PartyBalance,
  PartyMethodTotal,
  PartySearchResult,
  PartyLedgerEntry,
  PartyLedgerSummaryLine,
  PartySettlementLedger,
  PartyStatement,
  PeriodView,
  ProfitAndLoss,
  TransactionDirection,
  TransactionList,
  TransactionRow,
  TransactionScope,
  TrialBalance,
} from "../../types/accounting.type";
import { ACCOUNT, resolveAccounts } from "./accounts";
import { postJournal, reverseJournal, wasPosted } from "./posting.service";
import { syncExpensePostings } from "./sync";

type Actor = { id: string; roles: string[] };

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

const num = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const iso = (date: Date) => date.toISOString();

/**
 * Every entry counts toward every balance, including voided ones.
 *
 * This looks wrong at first and is the single most important rule in this file.
 * A voided entry is not removed from the books — it is cancelled by an equal
 * and opposite reversal entry, and the two net to zero. Excluding the original
 * while keeping its reversal would count the undo without the thing it undid,
 * which shows up as the balance being wrong by exactly twice the amount.
 *
 * `voided` therefore means "superseded, see its reversal", not "ignore this".
 * It drives how an entry is displayed and stops it being reversed twice; it has
 * no effect on arithmetic.
 */
const ALL_ENTRIES = Prisma.sql`TRUE`;

// ── Ranges ──────────────────────────────────────────────────────────────────

export interface RangeQuery {
  period?: string | undefined;
  fiscalYear?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Turns whatever the client asked for into an AD window.
 *
 * Three ways of saying "when", in order of how people actually think about it:
 * a BS month, a fiscal year, or explicit dates. Defaults to the current BS
 * month, which is the answer to "how are we doing" almost every time it is
 * asked.
 */
export function resolveRange(query: RangeQuery = {}): DateRange {
  if (query.period) {
    const { year, month } = parsePeriodKey(query.period);
    const { start, end } = bsMonthRange(year, month);
    return {
      from: start,
      to: end,
      label: `${BS_MONTH_NAMES[month - 1]} ${year}`,
      periodKey: query.period,
      fiscalYear: fiscalYearOf(start).code,
    };
  }

  if (query.fiscalYear) {
    const startYear = Number(String(query.fiscalYear).split("/")[0]);
    if (!Number.isFinite(startYear)) throw new AppError(400, "fiscalYear must look like 2083 or 2083/84");
    const fy = fiscalYear(startYear);
    return { from: fy.start, to: fy.end, label: `FY ${fy.code}`, periodKey: null, fiscalYear: fy.code };
  }

  if (query.from || query.to) {
    const from = query.from ? new Date(query.from) : new Date(0);
    // `to` is inclusive to the caller and exclusive here, so a request for a
    // single day returns that day rather than nothing.
    const to = query.to ? new Date(new Date(query.to).getTime() + 86_400_000) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, "from and to must be valid dates");
    }
    if (to <= from) throw new AppError(400, "to must be after from");
    return { from, to, label: `${formatBs(from)} to ${formatBs(new Date(to.getTime() - 1))}`, periodKey: null, fiscalYear: null };
  }

  const now = new Date();
  const periodKey = bsPeriodKey(now);
  const { year, month } = parsePeriodKey(periodKey);
  const { start, end } = bsMonthRange(year, month);
  return {
    from: start,
    to: end,
    label: `${BS_MONTH_NAMES[month - 1]} ${year}`,
    periodKey,
    fiscalYear: fiscalYearOf(start).code,
  };
}

const rangeView = (range: DateRange) => ({ from: iso(range.from), to: iso(range.to), label: range.label });

// ── The shared aggregate ────────────────────────────────────────────────────

interface RawTotal {
  id: string;
  code: string;
  name: string;
  type: string;
  normal_side: string;
  is_control: boolean;
  subledger_type: string | null;
  description: string | null;
  is_active: boolean;
  debit: string;
  credit: string;
}

/**
 * Debit and credit totals per account over a window.
 *
 * `from` of null means "since the beginning", which is what a balance sheet or
 * a trial balance wants; a P&L passes both ends. Accounts with no movement are
 * included so the chart always reads as a complete list.
 */
async function accountTotals(from: Date | null, to: Date): Promise<AccountBalance[]> {
  const rows = await prisma.$queryRaw<RawTotal[]>(Prisma.sql`
    SELECT a.id, a.code, a.name, a.type::text AS type, a.normal_side::text AS normal_side,
           a.is_control, a.subledger_type::text AS subledger_type, a.description, a.is_active,
           COALESCE(SUM(l.debit), 0)  AS debit,
           COALESCE(SUM(l.credit), 0) AS credit
      FROM ledger_accounts a
      -- The window goes on the lines join, not on a join to journal_entries.
      -- A date filter applied to the *right* side of a LEFT JOIN removes
      -- nothing: the line would survive with the entry columns NULL and still
      -- be summed, which silently turns every period report into an all-time
      -- one. journal_lines.entry_date is denormalized from the parent entry
      -- (safe - entries are immutable) precisely so this can be a single join,
      -- and idx_journal_lines_account_date covers it.
      --
      -- No status filter, deliberately: see ALL_ENTRIES above - voided entries
      -- still count, because their reversal counts too.
      LEFT JOIN journal_lines l
             ON l.account_id = a.id
            AND l.entry_date < ${to}
            ${from ? Prisma.sql`AND l.entry_date >= ${from}` : Prisma.empty}
     GROUP BY a.id, a.code, a.name, a.type, a.normal_side, a.is_control, a.subledger_type, a.description, a.is_active
     ORDER BY a.code
  `);

  // A retired account that has been emptied is dropped from every report built
  // on these totals. One that still holds money is not: hiding it would take
  // its balance off the balance sheet while the money is still there, and the
  // statement would stop balancing by exactly that amount.
  return rows.map(toAccountBalance).filter((account) => account.isActive || account.balance !== 0);
}

function toAccountBalance(row: RawTotal): AccountBalance {
  const debit = num(row.debit);
  const credit = num(row.credit);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as AccountBalance["type"],
    normalSide: row.normal_side as AccountBalance["normalSide"],
    isControl: row.is_control,
    subledgerType: row.subledger_type as AccountBalance["subledgerType"],
    description: row.description,
    isActive: row.is_active,
    debit,
    credit,
    // Signed on the account's own side: a debit account reports debits minus
    // credits, a credit account the reverse. Positive therefore always means
    // "a normal balance for this kind of account".
    balance: num(row.normal_side === "debit" ? debit - credit : credit - debit),
  };
}

// ── Chart of accounts ───────────────────────────────────────────────────────

/**
 * The chart as somewhere to post to or look at - so retired accounts are left
 * out. Their entries are still readable: getAccountLedger takes a code and does
 * not consult this list, so a link to a retired account still opens.
 */
/**
 * The chart of accounts, or just the accounts money moves through.
 *
 * `cash_bank` is 1000 Cash in Hand plus whatever account each payment method
 * books to - which is what makes it the real cash-and-bank set rather than a
 * guess from the account type. A method with no account of its own has no
 * balance to show, so it contributes nothing.
 */
export async function listAccounts(scope?: "cash_bank"): Promise<AccountSummary[]> {
  let where: Prisma.ledger_accountsWhereInput = { is_active: true };

  if (scope === "cash_bank") {
    const methods = await prisma.payment_methods.findMany({
      where: { ledger_account_id: { not: null } },
      select: { ledger_account_id: true },
    });
    const ids = methods.map((method) => method.ledger_account_id).filter((id): id is string => Boolean(id));
    where = {
      is_active: true,
      OR: [{ code: ACCOUNT.CASH_IN_HAND }, ...(ids.length ? [{ id: { in: ids } }] : [])],
    };
  }

  const rows = await prisma.ledger_accounts.findMany({
    where,
    orderBy: { code: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    normalSide: row.normal_side,
    isControl: row.is_control,
    subledgerType: row.subledger_type,
    description: row.description,
    isActive: row.is_active,
  }));
}

// ── Overview ────────────────────────────────────────────────────────────────

export async function getOverview(query: RangeQuery): Promise<AccountingOverview> {
  const range = resolveRange(query);

  const [cumulative, periodTotals, riderHoldings, recent, entryCount] = await Promise.all([
    // Cash and party positions are "as at now", not "during the period" - what
    // matters about cash is how much there is, not how much it moved.
    accountTotals(null, range.to),
    accountTotals(range.from, range.to),
    listPartyBalances("rider", { limit: 5, nonZeroOnly: true }),
    listJournal({ page: 1, pageSize: 6 }),
    prisma.journal_entries.count({ where: { entry_date: { gte: range.from, lt: range.to }, status: "posted" } }),
  ]);

  const byCode = new Map(cumulative.map((account) => [account.code, account]));
  const periodByCode = new Map(periodTotals.map((account) => [account.code, account]));

  // Every asset account that is not a control account is money the office
  // itself holds. Derived rather than listed, because payment methods create
  // their own accounts - a hardcoded list would silently omit the bank you
  // added last week, and the total would quietly stop being the total.
  //
  // The one asset this excludes is Cash with Rider, which is a control account:
  // real money, but in somebody else's pocket, and reported separately for
  // exactly that reason.
  const cash = cumulative
    .filter((account) => account.type === "asset" && !account.isControl)
    .filter((account) => account.isActive || account.balance !== 0)
    .map((account) => ({ code: account.code, name: account.name, balance: account.balance }));

  const sumType = (accounts: AccountBalance[], type: string) =>
    num(accounts.filter((a) => a.type === type).reduce((total, a) => total + a.balance, 0));

  const revenue = sumType(periodTotals, "revenue");
  const expenses = sumType(periodTotals, "expense");

  return {
    range: rangeView(range),
    cash,
    totalCash: num(cash.reduce((total, account) => total + account.balance, 0)),
    cashWithRiders: byCode.get(ACCOUNT.CASH_WITH_RIDER)?.balance ?? 0,
    vendorPosition: byCode.get(ACCOUNT.VENDOR_CONTROL)?.balance ?? 0,
    revenue,
    expenses,
    netProfit: num(revenue - expenses),
    // Movement within the period, read off the side each account moves on.
    codCollected: periodByCode.get(ACCOUNT.CASH_WITH_RIDER)?.debit ?? 0,
    paidToVendors: periodByCode.get(ACCOUNT.VENDOR_CONTROL)?.debit ?? 0,
    receivedFromRiders: periodByCode.get(ACCOUNT.CASH_WITH_RIDER)?.credit ?? 0,
    entryCount,
    topRiderHoldings: riderHoldings,
    recentEntries: recent.items,
  };
}

// ── Journal ─────────────────────────────────────────────────────────────────

export interface JournalQuery extends RangeQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  accountCode?: string | undefined;
  sourceType?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  /** Omit the range entirely - used by the overview's "latest entries". */
  unbounded?: boolean | undefined;
}

export async function listJournal(query: JournalQuery = {}): Promise<Paged<JournalEntryView>> {
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize ?? DEFAULT_PAGE_SIZE)));

  const hasRange = Boolean(query.period || query.fiscalYear || query.from || query.to);
  const range = hasRange ? resolveRange(query) : null;

  const where: Prisma.journal_entriesWhereInput = {
    ...(range ? { entry_date: { gte: range.from, lt: range.to } } : {}),
    ...(query.status && query.status !== "all" ? { status: query.status as "posted" | "voided" } : {}),
    ...(query.sourceType && query.sourceType !== "all" ? { source_type: query.sourceType } : {}),
    ...(query.accountCode ? { lines: { some: { account: { code: query.accountCode } } } } : {}),
    ...(query.search
      ? {
          OR: [
            { entry_no: { contains: query.search, mode: "insensitive" } },
            { memo: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.journal_entries.count({ where }),
    prisma.journal_entries.findMany({
      where,
      orderBy: [{ entry_date: "desc" }, { entry_no: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lines: { orderBy: { line_no: "asc" }, include: { account: { select: { code: true, name: true } } } },
        reversal_of: { select: { entry_no: true } },
        users: { select: { full_name: true } },
      },
    }),
  ]);

  const items = await decorateEntries(entries);
  return { items, total, page, pageSize };
}

type RawEntry = Prisma.journal_entriesGetPayload<{
  include: {
    lines: { include: { account: { select: { code: true; name: true } } } };
    reversal_of: { select: { entry_no: true } };
    users: { select: { full_name: true } };
  };
}>;

/** The shape both the journal and the transactions list need names for. */
interface PartyBearingLine {
  party_type: string | null;
  party_id: string | null;
  parcel_id: string | null;
}

/**
 * Names and tracking ids behind the ids on a set of lines.
 *
 * A thin pairing of resolvePartyNames (below, shared with the expense list) with
 * the parcel lookup only journal lines need - so there is one answer to "what is
 * this party called" across the whole file rather than one per caller.
 */
async function resolveLineNames(lines: PartyBearingLine[]) {
  const parcelIds = [...new Set(lines.map((line) => line.parcel_id).filter((id): id is string => Boolean(id)))];

  const [partyNames, parcels] = await Promise.all([
    resolvePartyNames(lines),
    parcelIds.length
      ? prisma.parcels.findMany({ where: { id: { in: parcelIds } }, select: { id: true, tracking_id: true } })
      : [],
  ]);

  return {
    nameOf: (partyType: string | null, partyId: string | null) =>
      partyType && partyId ? partyNames.get(`${partyType}:${partyId}`) ?? null : null,
    trackingIds: new Map(parcels.map((p) => [p.id, p.tracking_id])),
  };
}

async function decorateEntries(entries: RawEntry[]): Promise<JournalEntryView[]> {
  const { nameOf, trackingIds } = await resolveLineNames(entries.flatMap((entry) => entry.lines));

  return entries.map((entry) => ({
    id: entry.id,
    entryNo: entry.entry_no,
    entryDate: iso(entry.entry_date),
    bsDate: entry.bs_date,
    periodKey: entry.period_key,
    memo: entry.memo,
    sourceType: entry.source_type,
    sourceId: entry.source_id,
    eventKey: entry.event_key,
    status: entry.status,
    reversalOfId: entry.reversal_of_id,
    reversalOfNo: entry.reversal_of?.entry_no ?? null,
    postedByName: entry.users?.full_name ?? null,
    totalAmount: num(entry.lines.reduce((total, line) => total + Number(line.debit), 0)),
    lines: entry.lines.map((line) => ({
      accountId: line.account_id,
      accountCode: line.account.code,
      accountName: line.account.name,
      debit: num(line.debit),
      credit: num(line.credit),
      partyType: line.party_type,
      partyId: line.party_id,
      partyName: nameOf(line.party_type, line.party_id),
      parcelId: line.parcel_id,
      trackingId: line.parcel_id ? trackingIds.get(line.parcel_id) ?? null : null,
      memo: line.memo,
    })),
  }));
}

export async function getJournalEntry(entryId: string): Promise<JournalEntryView> {
  const entry = await prisma.journal_entries.findUnique({
    where: { id: entryId },
    include: {
      lines: { orderBy: { line_no: "asc" }, include: { account: { select: { code: true, name: true } } } },
      reversal_of: { select: { entry_no: true } },
      users: { select: { full_name: true } },
    },
  });
  if (!entry) throw new AppError(404, "Journal entry not found");
  const [view] = await decorateEntries([entry]);
  return view!;
}

// ── Account ledger ──────────────────────────────────────────────────────────

/**
 * One account's movements over a window, with a running balance.
 *
 * The opening balance is everything before the window, so the closing figure is
 * a real position rather than a period subtotal - otherwise a ledger opened on
 * the second month of the year would appear to start from nothing.
 */
export async function getAccountLedger(accountCode: string, query: RangeQuery): Promise<AccountLedger> {
  const range = resolveRange(query);
  const account = await prisma.ledger_accounts.findUnique({ where: { code: accountCode } });
  if (!account) throw new AppError(404, `Account ${accountCode} not found`);

  const debitNormal = account.normal_side === "debit";

  const [openingRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ debit: string; credit: string }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
       WHERE l.account_id = ${account.id}::uuid
         AND e.entry_date < ${range.from}
    `),
    prisma.$queryRaw<
      Array<{
        entry_id: string;
        entry_no: string;
        entry_date: Date;
        bs_date: string;
        memo: string | null;
        debit: string;
        credit: string;
        contra: string | null;
      }>
    >(Prisma.sql`
      SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.bs_date, e.memo,
             l.debit, l.credit,
             -- The other accounts in the same entry. Without this a ledger row
             -- says an amount moved but not what it moved against, which is the
             -- first question anyone reading a ledger asks.
             (
               SELECT string_agg(DISTINCT a2.name, ', ')
                 FROM journal_lines l2
                 JOIN ledger_accounts a2 ON a2.id = l2.account_id
                WHERE l2.entry_id = e.id AND l2.account_id <> l.account_id
             ) AS contra
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
       WHERE l.account_id = ${account.id}::uuid
         AND e.entry_date >= ${range.from}
         AND e.entry_date <  ${range.to}
       ORDER BY e.entry_date ASC, e.entry_no ASC, l.line_no ASC
       LIMIT 2000
    `),
  ]);

  const openingDebit = num(openingRows[0]?.debit);
  const openingCredit = num(openingRows[0]?.credit);
  const openingBalance = num(debitNormal ? openingDebit - openingCredit : openingCredit - openingDebit);

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;

  const ledgerRows: LedgerRow[] = rows.map((row) => {
    const debit = num(row.debit);
    const credit = num(row.credit);
    totalDebit += debit;
    totalCredit += credit;
    running = num(running + (debitNormal ? debit - credit : credit - debit));
    return {
      entryId: row.entry_id,
      entryNo: row.entry_no,
      entryDate: iso(row.entry_date),
      bsDate: row.bs_date,
      memo: row.memo,
      contraAccounts: row.contra ?? "",
      debit,
      credit,
      runningBalance: running,
    };
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      normalSide: account.normal_side,
      isControl: account.is_control,
      subledgerType: account.subledger_type,
      description: account.description,
      isActive: account.is_active,
    },
    range: rangeView(range),
    openingBalance,
    closingBalance: running,
    totalDebit: num(totalDebit),
    totalCredit: num(totalCredit),
    rows: ledgerRows,
  };
}

// ── Transactions ────────────────────────────────────────────────────────────

export interface TransactionQuery extends RangeQuery {
  scope: TransactionScope;
  /** Narrows a multi-account scope (bank) to one of its accounts. */
  accountCode?: string | undefined;
  direction?: TransactionDirection | undefined;
  partyId?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
}

/**
 * The accounts a scope covers.
 *
 * Cash and bank are derived rather than listed, because bank accounts are not
 * in the chart: each one is created alongside the payment method that uses it
 * (codes from 1100 up), so "which accounts are banks" can only be answered by
 * asking the database. A non-control asset that is not 1000 is one of them.
 */
async function accountsInScope(scope: TransactionScope): Promise<AccountSummary[]> {
  const codes: Record<"rider-cod" | "vendor-cod", string> = {
    "rider-cod": ACCOUNT.CASH_WITH_RIDER,
    "vendor-cod": ACCOUNT.VENDOR_CONTROL,
  };

  const where: Prisma.ledger_accountsWhereInput =
    scope === "cash"
      ? { code: ACCOUNT.CASH_IN_HAND }
      : scope === "bank"
        ? { type: "asset", is_control: false, code: { not: ACCOUNT.CASH_IN_HAND } }
        : { code: codes[scope] };

  const rows = await prisma.ledger_accounts.findMany({ where, orderBy: { code: "asc" } });
  return rows.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    normalSide: account.normal_side,
    isControl: account.is_control,
    subledgerType: account.subledger_type,
    description: account.description,
    isActive: account.is_active,
  }));
}

/**
 * Movements on a set of accounts, newest first.
 *
 * Line-level, unlike the journal: "cash payments" is a list of the credit side
 * of the cash account, and an entry that touches cash once alongside three
 * expense lines is one cash payment, not four. Ordered newest first because
 * this is a register being scanned, not a ledger being read down to a balance -
 * which is also why there is no running balance here and one on getAccountLedger.
 */
export async function listTransactions(query: TransactionQuery): Promise<TransactionList> {
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize ?? DEFAULT_PAGE_SIZE)));
  const direction: TransactionDirection = query.direction ?? "all";
  const range = resolveRange(query);

  const accounts = await accountsInScope(query.scope);
  // A narrowing code that is not in the scope is ignored rather than honoured:
  // asking for cash and passing a vendor's account code should not quietly
  // return that vendor's ledger.
  const selected = query.accountCode ? accounts.filter((a) => a.code === query.accountCode) : accounts;

  if (selected.length === 0) {
    return {
      scope: query.scope,
      direction,
      accounts,
      range: rangeView(range),
      rows: [],
      totals: { debit: 0, credit: 0 },
      total: 0,
      page,
      pageSize,
    };
  }

  const ids = Prisma.join(selected.map((account) => Prisma.sql`${account.id}::uuid`));
  const search = query.search?.trim();

  const filters = Prisma.sql`
      l.account_id IN (${ids})
      AND e.entry_date >= ${range.from}
      AND e.entry_date <  ${range.to}
      ${direction === "in" ? Prisma.sql`AND l.debit > 0` : Prisma.empty}
      ${direction === "out" ? Prisma.sql`AND l.credit > 0` : Prisma.empty}
      ${query.partyId ? Prisma.sql`AND l.party_id = ${query.partyId}::uuid` : Prisma.empty}
      ${
        search
          ? Prisma.sql`AND (e.entry_no ILIKE ${`%${search}%`} OR e.memo ILIKE ${`%${search}%`})`
          : Prisma.empty
      }
  `;

  const [summary, rows] = await Promise.all([
    // Totals span the whole filtered set, not the page: a register whose footer
    // only adds up the rows currently on screen answers a question nobody asked.
    prisma.$queryRaw<Array<{ total: bigint; debit: string; credit: string }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total,
             COALESCE(SUM(l.debit), 0)  AS debit,
             COALESCE(SUM(l.credit), 0) AS credit
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
       WHERE ${filters}
    `),
    prisma.$queryRaw<
      Array<{
        id: string;
        entry_id: string;
        entry_no: string;
        entry_date: Date;
        bs_date: string;
        memo: string | null;
        account_code: string;
        account_name: string;
        party_type: string | null;
        party_id: string | null;
        parcel_id: string | null;
        debit: string;
        credit: string;
        contra: string | null;
      }>
    >(Prisma.sql`
      SELECT l.id, e.id AS entry_id, e.entry_no, e.entry_date, e.bs_date, e.memo,
             a.code AS account_code, a.name AS account_name,
             l.party_type::text AS party_type, l.party_id, l.parcel_id,
             l.debit, l.credit,
             (
               SELECT string_agg(DISTINCT a2.name, ', ')
                 FROM journal_lines l2
                 JOIN ledger_accounts a2 ON a2.id = l2.account_id
                WHERE l2.entry_id = e.id AND l2.account_id <> l.account_id
             ) AS contra
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
        JOIN ledger_accounts a ON a.id = l.account_id
       WHERE ${filters}
       ORDER BY e.entry_date DESC, e.entry_no DESC, l.line_no ASC
       OFFSET ${(page - 1) * pageSize}
       LIMIT ${pageSize}
    `),
  ]);

  const { nameOf, trackingIds } = await resolveLineNames(rows);

  return {
    scope: query.scope,
    direction,
    accounts,
    range: rangeView(range),
    rows: rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      entryNo: row.entry_no,
      entryDate: iso(row.entry_date),
      bsDate: row.bs_date,
      memo: row.memo,
      accountCode: row.account_code,
      accountName: row.account_name,
      contraAccounts: row.contra ?? "",
      partyType: row.party_type as TransactionRow["partyType"],
      partyId: row.party_id,
      partyName: nameOf(row.party_type, row.party_id),
      trackingId: row.parcel_id ? trackingIds.get(row.parcel_id) ?? null : null,
      debit: num(row.debit),
      credit: num(row.credit),
    })),
    totals: { debit: num(summary[0]?.debit), credit: num(summary[0]?.credit) },
    total: Number(summary[0]?.total ?? 0),
    page,
    pageSize,
  };
}

// ── Party subledgers ────────────────────────────────────────────────────────

/**
 * Every party's balance on their control account.
 *
 * This is the answer to the two questions the office actually asks: which
 * riders are holding our cash, and where do we stand with each vendor.
 */
export async function listPartyBalances(
  partyType: "vendor" | "rider",
  options: { limit?: number | undefined; nonZeroOnly?: boolean | undefined; search?: string | undefined } = {},
): Promise<PartyBalance[]> {
  const debitNormal = partyType === "rider";
  const partyColumn = partyType === "vendor" ? Prisma.sql`s.vendor_id` : Prisma.sql`s.rider_id`;

  // Read from the statements, not from the control account. Since the
  // settlement-only migration nothing credits 1010 or 2000 any more, so a
  // journal-sourced pair here was the old per-parcel postings plus the mirror
  // entries that reversed them - two large figures that cancelled to the right
  // balance while describing nothing. These are the same source the settlement
  // ledger and the method breakdown already use, so a row now agrees with the
  // sheet it links to.
  //
  // Raised is what the statements say, settled is what was actually handed
  // over. A rider is debit-normal - they hold our cash until they remit it -
  // and a vendor credit-normal, so each pair is stated in that direction.
  const rows = await prisma.$queryRaw<Array<{ party_id: string; raised: string; settled: string }>>(Prisma.sql`
    SELECT ${partyColumn} AS party_id,
           COALESCE(SUM(
             ${partyType === "vendor" ? Prisma.sql`COALESCE(s.payable_amount, s.amount)` : Prisma.sql`s.amount`}
           ), 0) AS raised,
           COALESCE(SUM(paid.total), 0) AS settled
      FROM settlements s
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(sp.amount), 0) AS total
          FROM settlement_payments sp
         WHERE sp.settlement_id = s.id
      ) paid ON TRUE
     WHERE s.payee_type = ${partyType}
       AND ${partyColumn} IS NOT NULL
       AND s.status <> 'cancelled'
     GROUP BY 1
  `).then((result) =>
    result.map((row) => ({
      party_id: row.party_id,
      debit: debitNormal ? row.raised : row.settled,
      credit: debitNormal ? row.settled : row.raised,
    })),
  );

  const ids = rows.map((row) => row.party_id);
  if (ids.length === 0) return [];

  const names = new Map<string, { name: string; subtitle: string | null }>();
  if (partyType === "vendor") {
    const vendors = await prisma.vendors.findMany({
      where: { id: { in: ids } },
      select: { id: true, client_name: true, business_name: true, phone: true },
    });
    for (const vendor of vendors) {
      names.set(vendor.id, { name: vendor.business_name || vendor.client_name, subtitle: vendor.phone });
    }
  } else {
    const riders = await prisma.riders.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, phone: true },
    });
    for (const rider of riders) names.set(rider.id, { name: rider.name, subtitle: rider.phone });
  }

  // The same settled figure as above, split by method.
  const methodRows = await prisma.$queryRaw<Array<{ party_id: string; method: string; amount: string }>>(Prisma.sql`
    SELECT ${partyColumn} AS party_id,
           COALESCE(NULLIF(TRIM(b->>'method'), ''), 'Unspecified') AS method,
           SUM(COALESCE((b->>'amount')::numeric, 0)) AS amount
      FROM settlement_payments sp
      JOIN settlements s ON s.id = sp.settlement_id
      -- The CASE, not a WHERE guard: the lateral is evaluated before WHERE, so
      -- a breakdown that is not an array has to be neutralised here or the
      -- whole query errors on it.
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(sp.breakdown) = 'array' THEN sp.breakdown ELSE '[]'::jsonb END
      ) AS b
     WHERE s.payee_type = ${partyType}
       AND ${partyColumn} IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
       AND s.status <> 'cancelled'
     GROUP BY 1, 2
  `);

  const methodsByParty = new Map<string, PartyMethodTotal[]>();
  for (const row of methodRows) {
    const list = methodsByParty.get(row.party_id) ?? [];
    list.push({ method: row.method, amount: num(row.amount) });
    methodsByParty.set(row.party_id, list);
  }
  for (const list of methodsByParty.values()) list.sort((a, b) => b.amount - a.amount);

  let balances: PartyBalance[] = rows.map((row) => {
    const debit = num(row.debit);
    const credit = num(row.credit);
    const identity = names.get(row.party_id);
    return {
      partyId: row.party_id,
      // A party with ledger lines but no row left in its own table is a real
      // (if rare) state - deletion is soft everywhere, but a hard delete would
      // otherwise render this as a blank line.
      name: identity?.name ?? `Unknown ${partyType}`,
      subtitle: identity?.subtitle ?? null,
      debit,
      credit,
      balance: num(debitNormal ? debit - credit : credit - debit),
      methods: methodsByParty.get(row.party_id) ?? [],
    };
  });

  if (options.search) {
    const needle = options.search.toLowerCase();
    balances = balances.filter((row) => row.name.toLowerCase().includes(needle));
  }
  if (options.nonZeroOnly) balances = balances.filter((row) => row.balance !== 0);

  balances.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return options.limit ? balances.slice(0, options.limit) : balances;
}

/** One party's movements, in the same shape as an account ledger. */
export async function getPartyLedger(
  partyType: "vendor" | "rider",
  partyId: string,
  query: RangeQuery,
): Promise<AccountLedger & { partyName: string }> {
  const range = resolveRange(query);
  const code = partyType === "vendor" ? ACCOUNT.VENDOR_CONTROL : ACCOUNT.CASH_WITH_RIDER;
  const debitNormal = partyType === "rider";

  const account = await prisma.ledger_accounts.findUnique({ where: { code } });
  if (!account) throw new AppError(500, `Control account ${code} is missing from the chart of accounts`);

  const [openingRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ debit: string; credit: string }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
       WHERE l.account_id = ${account.id}::uuid
         AND l.party_id = ${partyId}::uuid
         AND e.entry_date < ${range.from}
    `),
    prisma.$queryRaw<
      Array<{
        entry_id: string;
        entry_no: string;
        entry_date: Date;
        bs_date: string;
        memo: string | null;
        debit: string;
        credit: string;
        contra: string | null;
      }>
    >(Prisma.sql`
      SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.bs_date,
             COALESCE(p.tracking_id, e.memo) AS memo,
             l.debit, l.credit,
             (
               SELECT string_agg(DISTINCT a2.name, ', ')
                 FROM journal_lines l2
                 JOIN ledger_accounts a2 ON a2.id = l2.account_id
                WHERE l2.entry_id = e.id AND l2.account_id <> l.account_id
             ) AS contra
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
        LEFT JOIN parcels p ON p.id = l.parcel_id
       WHERE l.account_id = ${account.id}::uuid
         AND l.party_id = ${partyId}::uuid
         AND e.entry_date >= ${range.from}
         AND e.entry_date <  ${range.to}
       ORDER BY e.entry_date ASC, e.entry_no ASC, l.line_no ASC
       LIMIT 2000
    `),
  ]);

  const openingBalance = num(
    debitNormal
      ? num(openingRows[0]?.debit) - num(openingRows[0]?.credit)
      : num(openingRows[0]?.credit) - num(openingRows[0]?.debit),
  );

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const ledgerRows: LedgerRow[] = rows.map((row) => {
    const debit = num(row.debit);
    const credit = num(row.credit);
    totalDebit += debit;
    totalCredit += credit;
    running = num(running + (debitNormal ? debit - credit : credit - debit));
    return {
      entryId: row.entry_id,
      entryNo: row.entry_no,
      entryDate: iso(row.entry_date),
      bsDate: row.bs_date,
      memo: row.memo,
      contraAccounts: row.contra ?? "",
      debit,
      credit,
      runningBalance: running,
    };
  });

  const identity =
    partyType === "vendor"
      ? await prisma.vendors.findUnique({ where: { id: partyId }, select: { client_name: true, business_name: true } })
      : await prisma.riders.findUnique({ where: { id: partyId }, select: { name: true } });

  const partyName =
    identity && "name" in identity
      ? identity.name
      : identity && "client_name" in identity
        ? identity.business_name || identity.client_name
        : `Unknown ${partyType}`;

  return {
    partyName,
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      normalSide: account.normal_side,
      isControl: account.is_control,
      subledgerType: account.subledger_type,
      description: account.description,
      isActive: account.is_active,
    },
    range: rangeView(range),
    openingBalance,
    closingBalance: running,
    totalDebit: num(totalDebit),
    totalCredit: num(totalCredit),
    rows: ledgerRows,
  };
}

// ── The party ledger ────────────────────────────────────────────────────────

/**
 * A rider's or vendor's ledger, driven by statements.
 *
 * Nothing accrues per parcel. A rider carrying COD owes nothing on this ledger
 * until a statement is raised naming the amount; the instalments against it are
 * what work the balance back down. Same shape on the vendor side, opposite
 * direction.
 *
 * Two rows per statement, not one, because they are two events on two dates:
 * the statement being raised, and each instalment landing. Collapsing them
 * would date the payment to the statement and lose the method.
 *
 * Read from settlements and settlement_payments rather than journal_lines: a
 * statement's posting nets to zero on the control account once it is fully
 * paid, so the journal can only show what is still outstanding.
 */
export async function getPartySettlementLedger(
  partyType: "rider" | "vendor",
  partyId: string,
  query: RangeQuery,
): Promise<PartySettlementLedger> {
  const range = resolveRange(query);
  const isRider = partyType === "rider";
  const partyColumn = isRider ? Prisma.sql`s.rider_id` : Prisma.sql`s.vendor_id`;

  const raisedAt = Prisma.sql`COALESCE(s.settlement_date, s.created_at)`;
  const belongsToParty = Prisma.sql`
      s.payee_type = ${partyType}
      AND ${partyColumn} = ${partyId}::uuid
      AND s.status <> 'cancelled'
  `;

  const [identity, openingRaised, openingPaid, statements, instalments] = await Promise.all([
    partyIdentity(partyType, partyId),
    prisma.$queryRaw<Array<{ amount: string; payable: string }>>(Prisma.sql`
      SELECT COALESCE(SUM(s.amount), 0)                             AS amount,
             COALESCE(SUM(COALESCE(s.payable_amount, s.amount)), 0) AS payable
        FROM settlements s
       WHERE ${belongsToParty} AND ${raisedAt} < ${range.from}
    `),
    prisma.$queryRaw<Array<{ paid: string }>>(Prisma.sql`
      SELECT COALESCE(SUM(sp.amount), 0) AS paid
        FROM settlement_payments sp
        JOIN settlements s ON s.id = sp.settlement_id
       WHERE ${belongsToParty} AND sp.paid_at < ${range.from}
    `),
    prisma.$queryRaw<
      Array<{
        id: string;
        statement_id: string;
        raised_at: Date;
        amount: string;
        payable: string;
        entry_id: string | null;
      }>
    >(Prisma.sql`
      SELECT s.id, s.statement_id, ${raisedAt} AS raised_at,
             s.amount, COALESCE(s.payable_amount, s.amount) AS payable,
             e.id AS entry_id
        FROM settlements s
        -- The live entry only: a restated statement has its superseded entries
        -- voided, and drilling into one would open a voucher that no longer
        -- says what this row says.
        LEFT JOIN LATERAL (
          SELECT je.id FROM journal_entries je
           WHERE je.source_type = 'settlement' AND je.source_id = s.id AND je.status = 'posted'
           ORDER BY je.created_at DESC LIMIT 1
        ) e ON TRUE
       WHERE ${belongsToParty}
         AND ${raisedAt} >= ${range.from} AND ${raisedAt} < ${range.to}
    `),
    prisma.$queryRaw<
      Array<{ id: string; statement_id: string; paid_at: Date; amount: string; method: string | null }>
    >(Prisma.sql`
      SELECT sp.id, s.statement_id, sp.paid_at, sp.amount, sp.method
        FROM settlement_payments sp
        JOIN settlements s ON s.id = sp.settlement_id
       WHERE ${belongsToParty}
         AND sp.paid_at >= ${range.from} AND sp.paid_at < ${range.to}
    `),
  ]);

  // The rider owes what the statements say they collected; the office owes the
  // vendor what the statements say is payable. Either way the instalments work
  // it off, so the opening figure is raised less paid.
  const openingRaisedTotal = num(isRider ? openingRaised[0]?.amount : openingRaised[0]?.payable);
  const openingBalance = num(openingRaisedTotal - num(openingPaid[0]?.paid));

  interface Movement {
    id: string;
    kind: "statement" | "instalment";
    reference: string;
    entryId: string | null;
    at: Date;
    description: string;
    debit: number;
    credit: number;
  }

  const movements: Movement[] = [];

  for (const statement of statements) {
    const amount = num(statement.amount);
    const payable = num(statement.payable);
    const raised = isRider ? amount : payable;
    if (raised === 0) continue;

    const charges = num(amount - payable);
    movements.push({
      id: `stm-${statement.id}`,
      kind: "statement",
      reference: statement.statement_id,
      entryId: statement.entry_id,
      at: statement.raised_at,
      description: isRider
        ? `COD collected ${money(raised)}`
        : `COD collected ${money(amount)}${charges !== 0 ? `, ${money(charges)} kept as charges` : ""}, ${money(payable)} due to vendor`,
      // A rider's statement is our money in their hands, so it debits them; a
      // vendor's is our debt to them, so it credits.
      debit: isRider ? raised : 0,
      credit: isRider ? 0 : raised,
    });
  }

  for (const instalment of instalments) {
    const amount = num(instalment.amount);
    if (amount === 0) continue;
    const method = instalment.method ? ` through ${instalment.method}` : "";
    movements.push({
      id: `pay-${instalment.id}`,
      kind: "instalment",
      reference: instalment.statement_id,
      entryId: null,
      at: instalment.paid_at,
      description: isRider
        ? `COD paid by rider ${money(amount)}${method}`
        : `COD paid to vendor ${money(amount)}${method}`,
      debit: isRider ? 0 : amount,
      credit: isRider ? amount : 0,
    });
  }

  movements.sort((a, b) => a.at.getTime() - b.at.getTime() || a.reference.localeCompare(b.reference));

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;

  const rows: PartyLedgerEntry[] = movements.map((movement) => {
    totalDebit += movement.debit;
    totalCredit += movement.credit;
    running = num(running + (isRider ? movement.debit - movement.credit : movement.credit - movement.debit));
    return {
      id: movement.id,
      kind: movement.kind,
      reference: movement.reference,
      entryId: movement.entryId,
      date: iso(movement.at),
      bsDate: formatBs(movement.at),
      description: movement.description,
      debit: movement.debit,
      credit: movement.credit,
      runningBalance: running,
    };
  });

  const raisedTotal = num(isRider ? totalDebit : totalCredit);
  const paidTotal = num(isRider ? totalCredit : totalDebit);

  const summary: PartyLedgerSummaryLine[] = isRider
    ? [
        { label: "Total COD collected", amount: raisedTotal },
        { label: "Total COD paid", amount: paidTotal },
        { label: "Still to pay", amount: running },
      ]
    : [
        { label: "Total COD collected", amount: raisedTotal },
        { label: "Total COD paid", amount: paidTotal },
        { label: "Still to pay", amount: running },
      ];

  return {
    partyType,
    partyId,
    partyName: identity.name,
    partySubtitle: identity.subtitle,
    range: rangeView(range),
    openingBalance,
    closingBalance: running,
    totalDebit: num(totalDebit),
    totalCredit: num(totalCredit),
    summary,
    rows,
  };
}

/** `NPR 15,000.00`, the way the descriptions on this ledger read. */
const money = (value: number) =>
  `NPR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function partyIdentity(
  partyType: "rider" | "vendor",
  partyId: string,
): Promise<{ name: string; subtitle: string | null }> {
  if (partyType === "rider") {
    const rider = await prisma.riders.findUnique({ where: { id: partyId }, select: { name: true, phone: true } });
    return { name: rider?.name ?? "Unknown rider", subtitle: rider?.phone ?? null };
  }
  const vendor = await prisma.vendors.findUnique({
    where: { id: partyId },
    select: { client_name: true, business_name: true, phone: true },
  });
  return {
    name: vendor ? vendor.business_name || vendor.client_name : "Unknown vendor",
    subtitle: vendor?.phone ?? null,
  };
}

// ── Party search and statement ──────────────────────────────────────────────

/**
 * Finds anyone money has moved for, by name or phone.
 *
 * One search across riders, vendors and staff, because from the finance side
 * they are the same question - "what have we paid this person, and what do they
 * owe us" - even though the system stores them in three unrelated tables.
 */
export async function searchParties(query: string, limit = 20): Promise<PartySearchResult[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];

  const contains = { contains: needle, mode: "insensitive" as const };

  const [riders, vendors] = await Promise.all([
    prisma.riders.findMany({
      where: { deleted_at: null, OR: [{ name: contains }, { phone: contains }] },
      select: { id: true, name: true, phone: true },
      take: limit,
    }),
    prisma.vendors.findMany({
      where: {
        deleted_at: null,
        OR: [{ client_name: contains }, { business_name: contains }, { phone: contains }],
      },
      select: { id: true, client_name: true, business_name: true, phone: true },
      take: limit,
    }),
  ]);

  return [
    ...riders.map((r) => ({ partyType: "rider" as const, partyId: r.id, name: r.name, subtitle: r.phone })),
    ...vendors.map((v) => ({
      partyType: "vendor" as const,
      partyId: v.id,
      name: v.business_name || v.client_name,
      subtitle: v.phone,
    })),
  ].slice(0, limit * 2);
}

/** The display name for a party, whichever table it lives in. */
async function partyName(partyType: string, partyId: string): Promise<string> {
  if (partyType === "rider") {
    const row = await prisma.riders.findUnique({ where: { id: partyId }, select: { name: true } });
    return row?.name ?? "Unknown rider";
  }
  if (partyType === "vendor") {
    const row = await prisma.vendors.findUnique({
      where: { id: partyId },
      select: { client_name: true, business_name: true },
    });
    return row ? row.business_name || row.client_name : "Unknown vendor";
  }
  const row = await prisma.users.findUnique({ where: { id: partyId }, select: { full_name: true } });
  return row?.full_name ?? "Unknown person";
}

/**
 * Everything the company has paid to or collected from one person.
 *
 * The important difference from getPartyLedger: that one reports a single
 * control account, which is what reconciliation needs. This one spans *every*
 * account, which is what a human needs - a rider's COD sits on 1010, their fuel
 * on 5100, their salary on 5300, and asking "what has this rider cost us" means
 * reading all three together.
 *
 * Grouped by account so the answer arrives as a summary first, with the
 * underlying movements beneath it.
 */
export async function getPartyStatement(
  partyType: string,
  partyId: string,
  query: RangeQuery,
): Promise<PartyStatement> {
  const range = resolveRange(query);

  const [name, groupRows, movements] = await Promise.all([
    partyName(partyType, partyId),
    prisma.$queryRaw<
      Array<{ code: string; name: string; type: string; normal_side: string; debit: string; credit: string }>
    >(Prisma.sql`
      SELECT a.code, a.name, a.type::text AS type, a.normal_side::text AS normal_side,
             COALESCE(SUM(l.debit), 0)  AS debit,
             COALESCE(SUM(l.credit), 0) AS credit
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
        JOIN ledger_accounts a ON a.id = l.account_id
       WHERE l.party_type = ${partyType}::ledger_party_type
         AND l.party_id = ${partyId}::uuid
         AND e.entry_date >= ${range.from}
         AND e.entry_date <  ${range.to}
       GROUP BY a.code, a.name, a.type, a.normal_side
       ORDER BY a.code
    `),
    prisma.$queryRaw<
      Array<{
        entry_id: string;
        entry_no: string;
        entry_date: Date;
        bs_date: string;
        memo: string | null;
        code: string;
        account_name: string;
        type: string;
        debit: string;
        credit: string;
        tracking_id: string | null;
      }>
    >(Prisma.sql`
      SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.bs_date, e.memo,
             a.code, a.name AS account_name, a.type::text AS type,
             l.debit, l.credit, p.tracking_id
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id AND ${ALL_ENTRIES}
        JOIN ledger_accounts a ON a.id = l.account_id
        LEFT JOIN parcels p ON p.id = l.parcel_id
       WHERE l.party_type = ${partyType}::ledger_party_type
         AND l.party_id = ${partyId}::uuid
         AND e.entry_date >= ${range.from}
         AND e.entry_date <  ${range.to}
       ORDER BY e.entry_date DESC, e.entry_no DESC
       LIMIT 1000
    `),
  ]);

  const groups = groupRows.map((row) => {
    const debit = num(row.debit);
    const credit = num(row.credit);
    return {
      code: row.code,
      name: row.name,
      type: row.type,
      debit,
      credit,
      balance: num(row.normal_side === "debit" ? debit - credit : credit - debit),
    };
  });

  // Two headline numbers, in the direction a person asks them. Money out is
  // what the company spent on this party (expense accounts); money in is what
  // it collected through them - COD a rider took in, charges a vendor bore.
  const paidOut = num(groups.filter((g) => g.type === "expense").reduce((sum, g) => sum + g.balance, 0));
  const collected = num(
    groups.filter((g) => g.code === ACCOUNT.CASH_WITH_RIDER).reduce((sum, g) => sum + g.debit, 0),
  );

  return {
    partyType,
    partyId,
    name,
    range: rangeView(range),
    groups,
    paidOut,
    collected,
    movements: movements.map((row) => ({
      entryId: row.entry_id,
      entryNo: row.entry_no,
      entryDate: iso(row.entry_date),
      bsDate: row.bs_date,
      memo: row.memo,
      accountCode: row.code,
      accountName: row.account_name,
      accountType: row.type,
      debit: num(row.debit),
      credit: num(row.credit),
      trackingId: row.tracking_id,
    })),
  };
}

// ── Statements ──────────────────────────────────────────────────────────────

export async function getTrialBalance(query: RangeQuery): Promise<TrialBalance> {
  const range = resolveRange(query);
  const accounts = (await accountTotals(null, range.to)).filter((a) => a.debit !== 0 || a.credit !== 0);

  const totalDebit = num(accounts.reduce((total, a) => total + a.debit, 0));
  const totalCredit = num(accounts.reduce((total, a) => total + a.credit, 0));

  return {
    asOf: iso(range.to),
    label: range.label,
    accounts,
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
  };
}

export async function getProfitAndLoss(query: RangeQuery): Promise<ProfitAndLoss> {
  const range = resolveRange(query);
  const accounts = await accountTotals(range.from, range.to);

  const revenue = accounts.filter((a) => a.type === "revenue" && a.balance !== 0);
  const expenses = accounts.filter((a) => a.type === "expense" && a.balance !== 0);
  const totalRevenue = num(revenue.reduce((total, a) => total + a.balance, 0));
  const totalExpenses = num(expenses.reduce((total, a) => total + a.balance, 0));

  return {
    range: rangeView(range),
    revenue,
    expenses,
    totalRevenue,
    totalExpenses,
    netProfit: num(totalRevenue - totalExpenses),
  };
}

/**
 * Assets = liabilities + equity, as at a date.
 *
 * Revenue and expense accounts are not shown as themselves. They roll into
 * equity as retained earnings, which is what makes the sheet balance - profit
 * the business has earned and not paid out is, by definition, owed to its
 * owners.
 */
export async function getBalanceSheet(query: RangeQuery): Promise<BalanceSheet> {
  const range = resolveRange(query);
  const accounts = await accountTotals(null, range.to);

  const pick = (type: string) => accounts.filter((a) => a.type === type && a.balance !== 0);
  const total = (rows: AccountBalance[]) => num(rows.reduce((sum, row) => sum + row.balance, 0));

  const assets = pick("asset");
  const liabilities = pick("liability");
  const equity = pick("equity");

  const retainedEarnings = num(
    total(accounts.filter((a) => a.type === "revenue")) - total(accounts.filter((a) => a.type === "expense")),
  );

  const totalAssets = total(assets);
  const totalLiabilities = total(liabilities);
  const totalEquity = num(total(equity) + retainedEarnings);
  const difference = num(totalAssets - totalLiabilities - totalEquity);

  return {
    asOf: iso(range.to),
    label: range.label,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    retainedEarnings,
    difference,
    balanced: difference === 0,
  };
}

// ── Periods ─────────────────────────────────────────────────────────────────

export async function listPeriods(): Promise<PeriodView[]> {
  const [periods, counts] = await Promise.all([
    prisma.accounting_periods.findMany({
      orderBy: [{ bs_year: "desc" }, { bs_month: "desc" }],
      include: { users: { select: { full_name: true } } },
    }),
    prisma.journal_entries.groupBy({ by: ["period_key"], _count: { _all: true } }),
  ]);

  const countByKey = new Map(counts.map((row) => [row.period_key, row._count._all]));
  const currentKey = bsPeriodKey(new Date());

  return periods.map((period) => ({
    periodKey: period.period_key,
    fiscalYear: period.fiscal_year,
    bsYear: period.bs_year,
    bsMonth: period.bs_month,
    monthName: BS_MONTH_NAMES[period.bs_month - 1] ?? String(period.bs_month),
    startsAt: iso(period.starts_at),
    endsAt: iso(period.ends_at),
    status: period.status,
    closedAt: period.closed_at ? iso(period.closed_at) : null,
    closedByName: period.users?.full_name ?? null,
    entryCount: countByKey.get(period.period_key) ?? 0,
    isCurrent: period.period_key === currentKey,
  }));
}

export async function setPeriodStatus(
  actor: Actor,
  periodKey: string,
  status: "open" | "closed",
): Promise<PeriodView> {
  const period = await prisma.accounting_periods.findUnique({ where: { period_key: periodKey } });
  if (!period) throw new AppError(404, `Period ${periodKey} has no entries yet, so there is nothing to close`);
  if (period.status === status) throw new AppError(400, `Period ${periodKey} is already ${status}`);

  // Closing out of order would leave a shut month behind an open one, and any
  // correction to the older month would then have nowhere legitimate to go.
  if (status === "closed") {
    const olderOpen = await prisma.accounting_periods.findFirst({
      where: { status: "open", starts_at: { lt: period.starts_at } },
      orderBy: { starts_at: "asc" },
    });
    if (olderOpen) {
      throw new AppError(400, `Close ${olderOpen.period_key} first - periods close oldest to newest`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.accounting_periods.update({
      where: { period_key: periodKey },
      data: {
        status,
        closed_by: status === "closed" ? actor.id : null,
        closed_at: status === "closed" ? new Date() : null,
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "accounting_period",
        entity_id: period.id,
        action: status === "closed" ? "CLOSE_ACCOUNTING_PERIOD" : "REOPEN_ACCOUNTING_PERIOD",
        old_data: { status: period.status },
        new_data: { status, periodKey },
      },
    });
  });

  const refreshed = await listPeriods();
  return refreshed.find((row) => row.periodKey === periodKey)!;
}

// ── Expenses ────────────────────────────────────────────────────────────────

const EXPENSE_INCLUDE = {
  account: { select: { code: true, name: true } },
  paid_from: { select: { code: true, name: true } },
  locations: { select: { name: true } },
  creator: { select: { full_name: true } },
} as const;

type RawExpense = Prisma.expensesGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

/**
 * Resolves `rider:uuid` style keys to display names, in three batched reads.
 *
 * The party dimension is polymorphic by design, so there is no join that does
 * this - and an expense list showing raw UUIDs where a rider's name should be
 * is not a list anyone can use.
 */
async function resolvePartyNames(
  parties: Array<{ party_type: string | null; party_id: string | null }>,
): Promise<Map<string, string>> {
  const byType = { rider: new Set<string>(), vendor: new Set<string>(), user: new Set<string>() };
  for (const row of parties) {
    if (!row.party_type || !row.party_id) continue;
    if (row.party_type in byType) byType[row.party_type as keyof typeof byType].add(row.party_id);
  }

  const [riders, vendors, users] = await Promise.all([
    byType.rider.size
      ? prisma.riders.findMany({ where: { id: { in: [...byType.rider] } }, select: { id: true, name: true } })
      : [],
    byType.vendor.size
      ? prisma.vendors.findMany({
          where: { id: { in: [...byType.vendor] } },
          select: { id: true, client_name: true, business_name: true },
        })
      : [],
    byType.user.size
      ? prisma.users.findMany({ where: { id: { in: [...byType.user] } }, select: { id: true, full_name: true } })
      : [],
  ]);

  const names = new Map<string, string>();
  for (const r of riders) names.set(`rider:${r.id}`, r.name);
  for (const v of vendors) names.set(`vendor:${v.id}`, v.business_name || v.client_name);
  for (const u of users) names.set(`user:${u.id}`, u.full_name);
  return names;
}

function toExpenseView(expense: RawExpense, partyNames?: Map<string, string>): ExpenseView {
  return {
    id: expense.id,
    expenseNo: expense.expense_no,
    expenseDate: iso(expense.expense_date),
    bsDate: expense.bs_date,
    accountCode: expense.account.code,
    accountName: expense.account.name,
    paidFromCode: expense.paid_from.code,
    paidFromName: expense.paid_from.name,
    amount: num(expense.amount),
    payee: expense.payee,
    reference: expense.reference,
    note: expense.note,
    locationId: expense.location_id,
    locationName: expense.locations?.name ?? null,
    partyType: expense.party_type,
    partyId: expense.party_id,
    partyName:
      expense.party_type && expense.party_id
        ? partyNames?.get(`${expense.party_type}:${expense.party_id}`) ?? null
        : null,
    status: expense.status,
    createdByName: expense.creator?.full_name ?? null,
    voidReason: expense.void_reason,
    createdAt: iso(expense.created_at),
  };
}

export async function listExpenses(
  query: RangeQuery & {
    page?: number | undefined;
    pageSize?: number | undefined;
    accountCode?: string | undefined;
    status?: string | undefined;
    partyType?: string | undefined;
    partyId?: string | undefined;
  },
): Promise<Paged<ExpenseView>> {
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize ?? DEFAULT_PAGE_SIZE)));
  const hasRange = Boolean(query.period || query.fiscalYear || query.from || query.to);
  const range = hasRange ? resolveRange(query) : null;

  const where: Prisma.expensesWhereInput = {
    ...(range ? { expense_date: { gte: range.from, lt: range.to } } : {}),
    ...(query.accountCode ? { account: { code: query.accountCode } } : {}),
    ...(query.status && query.status !== "all" ? { status: query.status as "recorded" | "voided" } : {}),
    ...(query.partyType && query.partyId
      ? { party_type: query.partyType as never, party_id: query.partyId }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.expenses.count({ where }),
    prisma.expenses.findMany({
      where,
      orderBy: [{ expense_date: "desc" }, { expense_no: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: EXPENSE_INCLUDE,
    }),
  ]);

  const partyNames = await resolvePartyNames(rows);
  return { items: rows.map((row) => toExpenseView(row, partyNames)), total, page, pageSize };
}

export async function createExpense(actor: Actor, input: CreateExpenseInput): Promise<ExpenseView> {
  const expenseDate = new Date(input.expenseDate);
  if (Number.isNaN(expenseDate.getTime())) throw new AppError(400, "expenseDate must be a valid date");
  if (!(input.amount > 0)) throw new AppError(400, "Amount must be greater than zero");

  const accounts = await resolveAccounts(prisma, [input.accountCode, input.paidFromCode]);
  const category = accounts.get(input.accountCode)!;
  const paidFrom = accounts.get(input.paidFromCode)!;

  // Guard rails that stop the books being quietly nonsense: an "expense" booked
  // against revenue, or one paid out of an account that holds no money.
  const [categoryRow, paidFromRow] = await Promise.all([
    prisma.ledger_accounts.findUnique({ where: { id: category.id }, select: { type: true, name: true } }),
    prisma.ledger_accounts.findUnique({ where: { id: paidFrom.id }, select: { type: true, name: true, is_control: true } }),
  ]);
  if (categoryRow?.type !== "expense") {
    throw new AppError(400, `${input.accountCode} is not an expense account`);
  }
  if (paidFromRow?.type !== "asset" || paidFromRow.is_control) {
    throw new AppError(400, `${input.paidFromCode} is not an account money can be paid out of`);
  }

  const created = await prisma.$transaction(async (tx) => {
    const numbered = await tx.$queryRaw<Array<{ expense_no: string }>>`
      SELECT ${`EXP-${fiscalYearOf(expenseDate).startYear}-`} || lpad(nextval('expense_no_seq')::text, 6, '0') AS expense_no
    `;
    const expenseNo = numbered[0]!.expense_no;

    const expense = await tx.expenses.create({
      data: {
        expense_no: expenseNo,
        expense_date: expenseDate,
        bs_date: formatBs(expenseDate),
        account_id: category.id,
        paid_from_id: paidFrom.id,
        amount: new Prisma.Decimal(input.amount),
        payee: input.payee?.trim() || null,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        location_id: input.locationId || null,
        party_type: input.partyType ?? null,
        party_id: input.partyId ?? null,
        created_by: actor.id,
      },
      include: EXPENSE_INCLUDE,
    });

    // The entry is the point of the record, so it is written in the same
    // transaction - an expense row with no posting behind it would be a lie.
    await syncExpensePostings(tx, [expense.id], { actorId: actor.id, reason: "expense recorded" });

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "expense",
        entity_id: expense.id,
        action: "CREATE_EXPENSE",
        new_data: { expenseNo, amount: input.amount, account: input.accountCode, paidFrom: input.paidFromCode },
      },
    });

    return expense;
  });

  return toExpenseView(created, await resolvePartyNames([created]));
}

export async function voidExpense(actor: Actor, expenseId: string, reason: string): Promise<ExpenseView> {
  const existing = await prisma.expenses.findUnique({ where: { id: expenseId } });
  if (!existing) throw new AppError(404, "Expense not found");
  if (existing.status === "voided") throw new AppError(400, "This expense has already been voided");
  if (!reason.trim()) throw new AppError(400, "A reason is required to void an expense");

  const updated = await prisma.$transaction(async (tx) => {
    const expense = await tx.expenses.update({
      where: { id: expenseId },
      data: { status: "voided", voided_by: actor.id, voided_at: new Date(), void_reason: reason.trim() },
      include: EXPENSE_INCLUDE,
    });

    // Voiding the record reverses the entry. The original posting stays in the
    // books alongside its reversal - that is what "voided" means here, not
    // "deleted".
    await syncExpensePostings(tx, [expenseId], { actorId: actor.id, reason: `expense voided: ${reason.trim()}` });

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "expense",
        entity_id: expenseId,
        action: "VOID_EXPENSE",
        old_data: { status: existing.status, amount: Number(existing.amount) },
        new_data: { status: "voided", reason: reason.trim() },
      },
    });

    return expense;
  });

  return toExpenseView(updated, await resolvePartyNames([updated]));
}

// ── Manual entries ──────────────────────────────────────────────────────────

/**
 * A hand-written journal entry.
 *
 * Deliberately not given `redateIfClosed`: a human backdating into a closed
 * period gets refused, which is the entire point of closing one. The automated
 * postings get the latitude because an operational event cannot be told to
 * happen in a different month.
 */
export async function createManualEntry(actor: Actor, input: CreateManualEntryInput): Promise<JournalEntryView> {
  const entryDate = new Date(input.entryDate);
  if (Number.isNaN(entryDate.getTime())) throw new AppError(400, "entryDate must be a valid date");
  if (!input.memo?.trim()) throw new AppError(400, "A description is required");
  if (!input.lines || input.lines.length < 2) throw new AppError(400, "A journal entry needs at least two lines");

  const entryId = await prisma.$transaction(async (tx) => {
    const outcome = await postJournal(tx, {
      entryDate,
      memo: input.memo.trim(),
      sourceType: "manual",
      // Null source_id keeps manual entries out of the idempotency index, which
      // is right: two identical adjustments on the same day are two events, not
      // one repeated.
      sourceId: null,
      eventKey: `manual:${Date.now()}`,
      postedBy: actor.id,
      lines: input.lines.map((line) => ({
        accountCode: line.accountCode,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        party: line.partyType && line.partyId ? { type: line.partyType, id: line.partyId } : undefined,
        memo: line.memo ?? null,
      })),
    });

    if (!wasPosted(outcome)) throw new AppError(400, "Every line was zero - there is nothing to post");

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "journal_entry",
        entity_id: outcome.id,
        action: "CREATE_MANUAL_ENTRY",
        new_data: { entryNo: outcome.entryNo, memo: input.memo.trim(), lineCount: input.lines.length },
      },
    });

    return outcome.id;
  });

  return getJournalEntry(entryId);
}

export async function reverseEntry(actor: Actor, entryId: string, reason: string): Promise<JournalEntryView> {
  if (!reason.trim()) throw new AppError(400, "A reason is required to reverse an entry");

  const original = await prisma.journal_entries.findUnique({
    where: { id: entryId },
    select: { id: true, entry_no: true, source_type: true },
  });
  if (!original) throw new AppError(404, "Journal entry not found");

  // Reversing an automated posting by hand would be undone the next time its
  // source row is touched, since the sync would see the ledger disagreeing with
  // the operational data and post it again. Correct the source instead.
  if (original.source_type !== "manual") {
    throw new AppError(
      400,
      `${original.entry_no} was posted automatically from a ${original.source_type} record. Correct that record instead - the ledger follows it.`,
    );
  }

  const reversalId = await prisma.$transaction(async (tx) => {
    const outcome = await reverseJournal(tx, { entryId, reason: reason.trim(), postedBy: actor.id });
    if (!wasPosted(outcome)) throw new AppError(400, "Nothing to reverse");

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "journal_entry",
        entity_id: entryId,
        action: "REVERSE_JOURNAL_ENTRY",
        new_data: { reversalEntryNo: outcome.entryNo, reason: reason.trim() },
      },
    });

    return outcome.id;
  });

  return getJournalEntry(reversalId);
}
