import type { RangeParams } from '../../services/accounting.service';
import { toBsDate } from '../../utils/nepaliDate';

// The reporting window every accounting screen shares, kept out of
// PeriodPicker.tsx so that file exports a component and nothing else (which is
// what React Fast Refresh needs to hot-reload it).

export type RangeMode = 'period' | 'fiscalYear' | 'custom';

export interface RangeSelection extends RangeParams {
  mode: RangeMode;
}

/** The BS month the books are currently in — everyone's default. */
export function currentPeriodKey(): string {
  const bs = toBsDate(new Date().toISOString());
  // toBsDate returns `YYYY-MM-DD`; a period key is its first seven characters.
  return bs ? bs.slice(0, 7) : '';
}

export const defaultRange = (): RangeSelection => ({ mode: 'period', period: currentPeriodKey() });

/** Strips the mode marker so the rest can go straight onto a request. */
export const rangeParams = (range: RangeSelection): RangeParams => {
  if (range.mode === 'period') return { period: range.period };
  if (range.mode === 'fiscalYear') return { fiscalYear: range.fiscalYear };
  return { from: range.from, to: range.to };
};
