// Shared formatting for vendor finance pages (Settlements, Order Payments,
// Pending COD, Delivery Charges), which previously each redefined their own
// slightly-diverging copy of the same currency/date formatting.

/**
 * The canonical way to render money. Two decimals, always.
 *
 * The columns are Decimal(12,2) and partial deliveries and return-percent
 * charges produce real paise, so rounding for display lies on exactly the rows
 * people dispute. It also means a vendor and an admin looking at the same
 * statement read the same number, which they did not while each screen chose
 * its own precision.
 */
export function formatMoney(value: number): string {
  return `Rs. ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Whole rupees, for aggregates only - dashboard stat cards and rollups, where
 * the figure is an indication rather than a number anyone will tie out.
 *
 * Never use this on a statement, an invoice, a ledger row or anything else that
 * has to reconcile. If two screens can show the same amount, both use
 * formatMoney.
 */
export function formatMoneyCompact(value: number): string {
  return `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * @deprecated Use formatMoney, or formatMoneyCompact for aggregates.
 *
 * The `decimals` parameter is why the same amount renders four different ways
 * across the app: it let each screen quietly pick its own precision, and vendor
 * pages aliased it to 0 while admin pages left it at 2. Callers should say
 * which they mean by choosing a function, not by passing a number.
 */
export function formatCurrency(value: number, decimals: 0 | 2 = 2): string {
  return decimals === 0 ? formatMoneyCompact(value) : formatMoney(value);
}

import { toBsDate } from './nepaliDate';

/** Dates are displayed in the Nepali calendar (Bikram Sambat) app-wide. */
export function formatDate(value?: string | null): string {
  if (!value) return '-';
  const bs = toBsDate(value);
  return bs || '-';
}
