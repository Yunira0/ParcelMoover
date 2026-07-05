// Shared formatting for vendor finance pages (Settlements, Order Payments,
// Pending COD, Delivery Charges), which previously each redefined their own
// slightly-diverging copy of the same currency/date formatting.

/** `decimals` defaults to 2 (matches Pending COD / Delivery Charges); pass 0 for whole-rupee display. */
export function formatCurrency(value: number, decimals: 0 | 2 = 2): string {
  return `Rs. ${value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

import { toBsDate } from './nepaliDate';

/** Dates are displayed in the Nepali calendar (Bikram Sambat) app-wide. */
export function formatDate(value?: string | null): string {
  if (!value) return '-';
  const bs = toBsDate(value);
  return bs || '-';
}
