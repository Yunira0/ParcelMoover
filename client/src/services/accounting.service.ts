import api from '../utils/api';

// ── Accounting ledger ────────────────────────────────────────────────────────
//
// Every money event in the system also posts a double-entry journal entry, so
// these endpoints are the one place that can answer "where is our money" across
// vendors, riders, cash and profit at the same time.
//
// Balances are signed on each account's own normal side: positive always means
// what the account is for — cash held, money owed to a vendor, revenue earned.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type PartyType = 'vendor' | 'rider' | 'payment_method' | 'location' | 'user';

/** The three ways of asking "when". The server reads them in this priority order. */
export interface RangeParams {
  /** A BS month, e.g. `2083-04`. */
  period?: string;
  /** A BS fiscal year (Shrawan–Ashadh), e.g. `2083`. */
  fiscalYear?: string;
  from?: string;
  to?: string;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalSide: 'debit' | 'credit';
  isControl: boolean;
  subledgerType: PartyType | null;
  description: string | null;
  isActive: boolean;
}

export interface AccountBalance extends Account {
  debit: number;
  credit: number;
  balance: number;
}

export interface JournalLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  partyType: PartyType | null;
  partyId: string | null;
  partyName: string | null;
  parcelId: string | null;
  trackingId: string | null;
  memo: string | null;
}

export interface JournalEntry {
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
  lines: JournalLine[];
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
  contraAccounts: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountLedger {
  account: Account;
  range: { from: string; to: string; label: string };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  rows: LedgerRow[];
}

export type PartyLedger = AccountLedger & { partyName: string };

export interface PartyBalance {
  partyId: string;
  name: string;
  subtitle: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface PartySearchResult {
  partyType: 'rider' | 'vendor' | 'user';
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
  groups: PartyAccountGroup[];
  paidOut: number;
  collected: number;
  movements: PartyMovement[];
}

export interface AccountingOverview {
  range: { from: string; to: string; label: string };
  cash: { code: string; name: string; balance: number }[];
  totalCash: number;
  cashWithRiders: number;
  vendorPosition: number;
  revenue: number;
  expenses: number;
  netProfit: number;
  codCollected: number;
  paidToVendors: number;
  receivedFromRiders: number;
  entryCount: number;
  topRiderHoldings: PartyBalance[];
  recentEntries: JournalEntry[];
}

export interface AccountingPeriod {
  periodKey: string;
  fiscalYear: string;
  bsYear: number;
  bsMonth: number;
  monthName: string;
  startsAt: string;
  endsAt: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedByName: string | null;
  entryCount: number;
  isCurrent: boolean;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const getOverview = async (params: RangeParams = {}): Promise<AccountingOverview> => {
  const response = await api.get('/accounting/overview', { params });
  return response.data.data;
};

export const listAccounts = async (): Promise<Account[]> => {
  const response = await api.get('/accounting/accounts');
  return response.data.data;
};

export const listJournal = async (
  params: RangeParams & {
    page?: number;
    pageSize?: number;
    accountCode?: string;
    sourceType?: string;
    status?: string;
    search?: string;
  } = {},
): Promise<Paged<JournalEntry>> => {
  const response = await api.get('/accounting/journal', { params });
  return response.data.data;
};

/** Which set of accounts a Transactions screen is about. */
export type TransactionScope = 'rider-cod' | 'vendor-cod' | 'cash' | 'bank';

/** `in` is the debit side of the account, `out` the credit side. */
export type TransactionDirection = 'in' | 'out' | 'all';

/** One movement on one account — a journal line, not a whole entry. */
export interface TransactionRow {
  id: string;
  entryId: string;
  entryNo: string;
  entryDate: string;
  bsDate: string;
  memo: string | null;
  accountCode: string;
  accountName: string;
  contraAccounts: string;
  partyType: PartyType | null;
  partyId: string | null;
  partyName: string | null;
  trackingId: string | null;
  debit: number;
  credit: number;
}

export interface TransactionList {
  scope: TransactionScope;
  direction: TransactionDirection;
  /** Every account in scope, for the picker. One for cash, several for bank. */
  accounts: Account[];
  range: { from: string; to: string; label: string };
  rows: TransactionRow[];
  /** Over the whole filtered set, not just the page on screen. */
  totals: { debit: number; credit: number };
  total: number;
  page: number;
  pageSize: number;
}

export const listTransactions = async (
  params: RangeParams & {
    scope: TransactionScope;
    accountCode?: string;
    direction?: TransactionDirection;
    partyId?: string;
    page?: number;
    pageSize?: number;
    search?: string;
  },
): Promise<TransactionList> => {
  const response = await api.get('/accounting/transactions', { params });
  return response.data.data;
};

export const getJournalEntry = async (id: string): Promise<JournalEntry> => {
  const response = await api.get(`/accounting/journal/${id}`);
  return response.data.data;
};

export const getAccountLedger = async (code: string, params: RangeParams = {}): Promise<AccountLedger> => {
  const response = await api.get(`/accounting/ledger/${code}`, { params });
  return response.data.data;
};

export const listPartyBalances = async (
  partyType: 'vendor' | 'rider',
  params: { search?: string; nonZeroOnly?: boolean } = {},
): Promise<PartyBalance[]> => {
  const response = await api.get(`/accounting/parties/${partyType}`, {
    params: { ...params, nonZeroOnly: params.nonZeroOnly ? 'true' : undefined },
  });
  return response.data.data;
};

export const getPartyLedger = async (
  partyType: 'vendor' | 'rider',
  partyId: string,
  params: RangeParams = {},
): Promise<PartyLedger> => {
  const response = await api.get(`/accounting/parties/${partyType}/${partyId}`, { params });
  return response.data.data;
};

/** Riders, vendors and staff in one lookup. */
export const searchParties = async (q: string): Promise<PartySearchResult[]> => {
  const response = await api.get('/accounting/party-search', { params: { q } });
  return response.data.data;
};

/** Everything paid to or collected from one person, across every account. */
export const getPartyStatement = async (
  partyType: string,
  partyId: string,
  params: RangeParams = {},
): Promise<PartyStatement> => {
  const response = await api.get(`/accounting/statement/${partyType}/${partyId}`, { params });
  return response.data.data;
};

export const listPeriods = async (): Promise<AccountingPeriod[]> => {
  const response = await api.get('/accounting/periods');
  return response.data.data;
};

// ── Writes ───────────────────────────────────────────────────────────────────

export const createManualEntry = async (input: {
  entryDate: string;
  memo: string;
  lines: {
    accountCode: string;
    debit?: number;
    credit?: number;
    memo?: string;
    // Required on a control account (1010, 2000): its balance is only
    // meaningful per party, so the server rejects an untagged line.
    partyType?: PartyType;
    partyId?: string;
  }[];
}): Promise<JournalEntry> => {
  const response = await api.post('/accounting/journal', input);
  return response.data.data;
};

export const reverseEntry = async (id: string, reason: string): Promise<JournalEntry> => {
  const response = await api.post(`/accounting/journal/${id}/reverse`, { reason });
  return response.data.data;
};
