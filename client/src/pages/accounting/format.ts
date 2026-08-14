import type { StatCardTone } from '../../components/StatCard';
import { formatCurrency } from '../../utils/format';

// How the Finance section writes a figure. Every tab was formatting its own
// money and picking its own sign colour, which is how seven screens end up
// looking like seven products.

export const money = (value: number) => formatCurrency(value, 2);

/** Tone for a figure on a <StatCard>. */
export const cardTone = (value: number): StatCardTone =>
  value > 0 ? 'positive' : value < 0 ? 'negative' : 'muted';

/** Class for a figure in a ledger cell: right-aligned, tabular, sign-coloured. */
export const numClass = (value: number) =>
  `acc-num ${value > 0 ? 'acc-pos' : value < 0 ? 'acc-neg' : 'acc-muted'}`;
