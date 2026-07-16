import NepaliDate from 'nepali-date-converter';

// Nepal Standard Time is a fixed UTC+5:45 (no DST). ISO timestamps are shifted
// by it before taking the calendar day, so the BS date matches Nepal's day
// regardless of the viewer's machine timezone. Server-produced "YYYY-MM-DD"
// strings are already Nepal-local and are converted as-is.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** AD date (ISO timestamp, "YYYY-MM-DD", or Date) → BS "YYYY-MM-DD". Falls back to the input. */
export function toBsDate(value?: string | Date | null): string {
  if (!value) return '';

  let y: number;
  let m: number;
  let d: number;

  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (dateOnly) {
      y = Number(dateOnly[1]);
      m = Number(dateOnly[2]);
      d = Number(dateOnly[3]);
    } else {
      const at = new Date(value);
      if (isNaN(at.getTime())) return value;
      const npt = new Date(at.getTime() + NEPAL_OFFSET_MS);
      y = npt.getUTCFullYear();
      m = npt.getUTCMonth() + 1;
      d = npt.getUTCDate();
    }
  } else {
    const npt = new Date(value.getTime() + NEPAL_OFFSET_MS);
    y = npt.getUTCFullYear();
    m = npt.getUTCMonth() + 1;
    d = npt.getUTCDate();
  }

  try {
    const AnyNepali = NepaliDate as any;
    const ad = new Date(y, m - 1, d);
    const nd = AnyNepali.fromAD ? AnyNepali.fromAD(ad) : new AnyNepali(ad);
    const bs = nd.getBS
      ? nd.getBS()
      : { year: nd.getYear(), month: nd.getMonth(), date: nd.getDate() };
    return `${bs.year}-${pad(bs.month + 1)}-${pad(bs.date)}`;
  } catch {
    return typeof value === 'string' ? value : '';
  }
}
