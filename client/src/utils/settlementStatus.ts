import type { StatusChipTone } from '../components/StatusChip';
import type { SettlementStatus } from '../services/finance.service';

// One place for how a settlement status reads, so the COD Management list, the
// vendor's own list and the statement detail page can't drift into calling the
// same state different things.
const STATUS_PRESENTATION: Record<SettlementStatus, { label: string; tone: StatusChipTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  // Its own tone rather than reusing "pending": money has moved, which matters
  // to anyone scanning the list for statements that still need paying.
  partially_paid: { label: 'Partially paid', tone: 'info' },
  settled: { label: 'Settled', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const FALLBACK = { label: 'Pending', tone: 'warning' as StatusChipTone };

export const settlementStatusLabel = (status: SettlementStatus): string =>
  (STATUS_PRESENTATION[status] ?? FALLBACK).label;

export const settlementStatusTone = (status: SettlementStatus): StatusChipTone =>
  (STATUS_PRESENTATION[status] ?? FALLBACK).tone;

/** Statements that still owe the payee something, and so can take a payment. */
export const isSettlementPayable = (status: SettlementStatus): boolean =>
  status === 'pending' || status === 'partially_paid';

/** Statements with at least one payment on record — the ones that carry proof. */
export const hasSettlementPayments = (status: SettlementStatus): boolean =>
  status === 'settled' || status === 'partially_paid';
