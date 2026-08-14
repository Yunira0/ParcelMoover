import type { ledger_account_type, ledger_normal_side, ledger_party_type } from "../generated/prisma/enums";

// Every amount crossing this boundary is a `number` in rupees, rounded to two
// decimals. Decimal precision is kept where it matters - in the database and in
// the posting engine - but the API speaks the same language as the rest of this
// codebase rather than shipping Decimal objects the client would have to parse.

/** A resolved reporting window, in AD, with the BS labels it was derived from. */
export interface DateRange {
  from: Date;
  to: Date;
  /** Human label, e.g. "Shrawan 2083" or "FY 2083/84". */
  label: string;
  periodKey: string | null;
  fiscalYear: string | null;
}

export interface AccountSummary {
  id: string;
  code: string;
  name: string;
  type: ledger_account_type;
  normalSide: ledger_normal_side;
  isControl: boolean;
  subledgerType: ledger_party_type | null;
  description: string | null;
  isActive: boolean;
}

export interface AccountBalance extends AccountSummary {
  debit: number;
  credit: number;
  /** Signed on the account's own normal side: positive means a normal balance. */
  balance: number;
}

export interface JournalLineView {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  partyType: ledger_party_type | null;
  partyId: string | null;
  partyName: string | null;
  parcelId: string | null;
  trackingId: string | null;
  memo: string | null;
}

export interface JournalEntryView {
  id: string;
  entryNo: string;
  entryDate: string;
  bsDate: string;
  periodKey: string;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  eventKey: string;
  status: string;
  reversalOfId: string | null;
  reversalOfNo: string | null;
  postedByName: string | null;
  totalAmount: number;
  lines: JournalLineView[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LedgerRow {
  entryId: string;
  entryNo: string;
  entryDate: string;
  bsDate: string;
  memo: string | null;
  /** The other side(s) of the entry, so a ledger row reads as a sentence. */
  contraAccounts: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountLedger {
  account: AccountSummary;
  range: { from: string; to: string; label: string };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  rows: LedgerRow[];
}

/**
 * Which set of accounts a transactions list is about.
 *
 * The four Transactions screens ask the same question of different accounts, so
 * they are one query with a scope rather than four endpoints.
 */
export type TransactionScope = "rider-cod" | "vendor-cod" | "cash" | "bank";

/** `in` is the debit side of the account, `out` the credit side. */
export type TransactionDirection = "in" | "out" | "all";

/** One movement on one account - a journal *line*, not a whole entry. */
export interface TransactionRow {
  /** Line id. Unique per row, which the entry id is not when an entry touches the same account twice. */
  id: string;
  entryId: string;
  entryNo: string;
  entryDate: string;
  bsDate: string;
  memo: string | null;
  accountCode: string;
  accountName: string;
  /** The other side(s) of the entry, so a row reads as a sentence. */
  contraAccounts: string;
  partyType: ledger_party_type | null;
  partyId: string | null;
  partyName: string | null;
  trackingId: string | null;
  debit: number;
  credit: number;
}

export interface TransactionList {
  scope: TransactionScope;
  direction: TransactionDirection;
  /** Every account in scope, for the picker. One entry for cash, several for bank. */
  accounts: AccountSummary[];
  range: { from: string; to: string; label: string };
  rows: TransactionRow[];
  /** Over the whole filtered set, not just the page on screen. */
  totals: { debit: number; credit: number };
  total: number;
  page: number;
  pageSize: number;
}

export interface PartyBalance {
  partyId: string;
  name: string;
  subtitle: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface PartySearchResult {
  partyType: "rider" | "vendor" | "user";
  partyId: string;
  name: string;
  subtitle: string | null;
}

export interface PartyAccountGroup {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface PartyMovement {
  entryId: string;
  entryNo: string;
  entryDate: string;
  bsDate: string;
  memo: string | null;
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  trackingId: string | null;
}

/** Everything the company has paid to or collected from one person. */
export interface PartyStatement {
  partyType: string;
  partyId: string;
  name: string;
  range: { from: string; to: string; label: string };
  /** One row per account this party appears on, summarised. */
  groups: PartyAccountGroup[];
  /** Total spent on them (expense accounts). */
  paidOut: number;
  /** Total collected through them (COD taken in). */
  collected: number;
  movements: PartyMovement[];
}

export interface TrialBalance {
  asOf: string;
  label: string;
  accounts: AccountBalance[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface ProfitAndLoss {
  range: { from: string; to: string; label: string };
  revenue: AccountBalance[];
  expenses: AccountBalance[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export interface BalanceSheet {
  asOf: string;
  label: string;
  assets: AccountBalance[];
  liabilities: AccountBalance[];
  equity: AccountBalance[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** Revenue less expenses to date, shown within equity so the sheet balances. */
  retainedEarnings: number;
  difference: number;
  balanced: boolean;
}

export interface CashPositionAccount {
  code: string;
  name: string;
  balance: number;
}

export interface AccountingOverview {
  range: { from: string; to: string; label: string };
  /** Money the office itself holds, by account. */
  cash: CashPositionAccount[];
  totalCash: number;
  /** Collected but not yet remitted - an asset, but not in hand. */
  cashWithRiders: number;
  /** Positive: owed to vendors. Negative: owed by them. */
  vendorPosition: number;
  revenue: number;
  expenses: number;
  netProfit: number;
  codCollected: number;
  paidToVendors: number;
  receivedFromRiders: number;
  entryCount: number;
  /** Riders holding the most cash right now - the day-to-day collection risk. */
  topRiderHoldings: PartyBalance[];
  recentEntries: JournalEntryView[];
}

export interface PeriodView {
  periodKey: string;
  fiscalYear: string;
  bsYear: number;
  bsMonth: number;
  monthName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  closedAt: string | null;
  closedByName: string | null;
  entryCount: number;
  isCurrent: boolean;
}

export interface ExpenseView {
  id: string;
  expenseNo: string;
  expenseDate: string;
  bsDate: string;
  accountCode: string;
  accountName: string;
  paidFromCode: string;
  paidFromName: string;
  amount: number;
  payee: string | null;
  reference: string | null;
  note: string | null;
  locationId: string | null;
  locationName: string | null;
  partyType: string | null;
  partyId: string | null;
  partyName: string | null;
  status: string;
  createdByName: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface CreateExpenseInput {
  accountCode: string;
  paidFromCode: string;
  amount: number;
  expenseDate: string;
  payee?: string | undefined;
  reference?: string | undefined;
  note?: string | undefined;
  locationId?: string | undefined;
  /** Who it was spent on, so it appears on their statement. */
  partyType?: "rider" | "vendor" | "user" | undefined;
  partyId?: string | undefined;
}

export interface ManualEntryLineInput {
  accountCode: string;
  debit?: number | undefined;
  credit?: number | undefined;
  partyType?: ledger_party_type | undefined;
  partyId?: string | undefined;
  memo?: string | undefined;
}

export interface CreateManualEntryInput {
  entryDate: string;
  memo: string;
  lines: ManualEntryLineInput[];
}
