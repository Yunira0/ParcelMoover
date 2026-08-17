import type { TransactionDirection, TransactionScope } from '../../services/accounting.service';

// What each Transactions screen calls itself and its columns.
//
// Six screens, one component: rider COD is account 1010, vendor COD is 2000, a
// cash payment is the credit side of 1000. Only the wording differs, so only
// the wording lives here — and it lives apart from the component so the page
// shell and the tab body title themselves from the same source.

export interface ScreenConfig {
  title: string;
  subtitle: string;
  /** What the party column is called on this screen. */
  partyLabel: string;
  /** Column headings for the two sides, when both are shown. */
  debitLabel: string;
  creditLabel: string;
}

/** Keyed by `scope:direction` — the six screens the routes actually mount. */
const CONFIG: Record<string, ScreenConfig> = {
  'rider-cod:all': {
    title: 'Rider COD',
    subtitle: 'COD collected on delivery, and cash remitted back to the office',
    partyLabel: 'Rider',
    debitLabel: 'Collected',
    creditLabel: 'Remitted',
  },
  'vendor-cod:all': {
    title: 'Vendor COD',
    subtitle: 'COD collected for vendors, charges earned, and payouts made',
    partyLabel: 'Vendor',
    debitLabel: 'Paid / charged',
    creditLabel: 'Collected',
  },
  'cash:out': {
    title: 'Cash Payments',
    subtitle: 'Money paid out of cash in hand',
    partyLabel: 'Party',
    debitLabel: 'In',
    creditLabel: 'Amount',
  },
  'cash:in': {
    title: 'Cash Receipts',
    subtitle: 'Money received into cash in hand',
    partyLabel: 'Party',
    debitLabel: 'Amount',
    creditLabel: 'Out',
  },
  'bank:out': {
    title: 'Bank Payments',
    subtitle: 'Money paid out of a bank or wallet account',
    partyLabel: 'Party',
    debitLabel: 'In',
    creditLabel: 'Amount',
  },
  'bank:in': {
    title: 'Bank Receipts',
    subtitle: 'Money received into a bank or wallet account',
    partyLabel: 'Party',
    debitLabel: 'Amount',
    creditLabel: 'Out',
  },
};

const FALLBACK: ScreenConfig = {
  title: 'Transactions',
  subtitle: 'Movements on these accounts',
  partyLabel: 'Party',
  debitLabel: 'Debit',
  creditLabel: 'Credit',
};

export const screenConfig = (scope: TransactionScope, direction: TransactionDirection): ScreenConfig =>
  CONFIG[`${scope}:${direction}`] ?? FALLBACK;
