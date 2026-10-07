import type { NavigateFunction } from 'react-router-dom';
import type { TallyAction } from './TallyPage';

/**
 * The one key layout every Finance screen shares, after TallyPrime's: F5/F6/F7
 * open Payment/Receipt/Journal from anywhere, F8 is a ledger, F12 the Day Book,
 * Alt+P/Alt+E print and export, Ctrl+A accepts a form, Esc quits. A key means
 * the same thing on every screen, which is the whole value of having them.
 *
 * F8 and F12 are Sales and Configure in Tally; this app has neither, so they
 * carry Ledger and Day Book instead.
 */

export const DAY_BOOK = '/accounting/transactions/journal';

/** "Escape" reads as "Esc" on a key cap. */
export const keyLabel = (key: string) => (key === 'Escape' ? 'Esc' : key);

/** F5/F6/F7 — raise a new voucher. */
export const voucherActions = (navigate: NavigateFunction): TallyAction[] => [
  { key: 'F5', label: 'Payment', onSelect: () => navigate('/finance/voucher/new?type=payment') },
  { key: 'F6', label: 'Receipt', onSelect: () => navigate('/finance/voucher/new?type=receipt') },
  { key: 'F7', label: 'Journal', onSelect: () => navigate('/finance/journal/new') },
];

export const dayBookAction = (navigate: NavigateFunction): TallyAction => ({
  key: 'F12',
  label: 'Day Book',
  onSelect: () => navigate(DAY_BOOK),
});

export const printAction = (): TallyAction => ({ key: 'Alt+P', label: 'Print', onSelect: () => window.print() });

export const exportAction = (onSelect: () => void, disabled = false): TallyAction => ({
  key: 'Alt+E',
  label: 'Export',
  onSelect,
  disabled,
});

export const quitAction = (onSelect: () => void): TallyAction => ({ key: 'Escape', label: 'Quit', onSelect });

/**
 * A voucher type as a day book names it: the kind of voucher, not the
 * subsystem that raised it — money coming in is a Receipt whether it came off
 * a delivery or a remittance.
 */
const SOURCE_VOUCHER_TYPES: Record<string, string> = {
  cod_collection: 'Receipt',
  // Ledger rows name the payee (see VOUCHER_SOURCE on the server): a rider's
  // statement brings money in, a vendor's pays it out.
  settlement_rider: 'Receipt',
  settlement_vendor: 'Payment',
  branch_settlement: 'Receipt',
  carrier_settlement: 'Receipt',
  parcel: 'Sales',
  vendor_payment: 'Payment',
  expense: 'Payment',
  manual: 'Journal',
  reversal: 'Journal',
  opening_balance: 'Journal',
};

export const voucherTypeOf = (sourceType: string): string => SOURCE_VOUCHER_TYPES[sourceType] ?? 'Journal';

/**
 * A hand-posted entry's type, read from what it did to cash and bank: money
 * out of them is a Payment, into them a Receipt, between them a Contra. The
 * Cash & Bank voucher posts as a manual entry, so without this every payment
 * typed there would read as a Journal.
 */
export const manualVoucherType = (
  lines: { accountCode: string; debit: number; credit: number }[],
  cashBankCodes: ReadonlySet<string>,
): string => {
  const cash = lines.filter((line) => cashBankCodes.has(line.accountCode));
  if (cash.length === 0) return 'Journal';
  if (cash.length === lines.length) return 'Contra';
  if (cash.every((line) => line.credit > 0)) return 'Payment';
  if (cash.every((line) => line.debit > 0)) return 'Receipt';
  return 'Journal';
};
