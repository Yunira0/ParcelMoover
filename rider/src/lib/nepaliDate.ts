import NepaliDate from 'nepali-date-converter';

// Nepal Standard Time is a fixed UTC+5:45 (no DST). ISO timestamps are shifted
// by it before taking the calendar day, so the BS date matches Nepal's day
// regardless of the viewer's machine timezone. Server-produced "YYYY-MM-DD"
// strings are already Nepal-local and are converted as-is.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** AD date (ISO timestamp, "YYYY-MM-DD", or Date) → BS "YYYY-MM-DD". Falls back to the input. */
export function toBsDate(value?: string | Date | null): string {  if (!value) return '';

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

// ── Devanagari display form ────────────────────────────────────────────────
// "सोम २४ भदौं" — the compact weekday/day/month line shown on the dashboard.

const NP_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const NP_WEEKDAYS = ['आइत', 'सोम', 'मङ्गल', 'बुध', 'बिही', 'शुक्र', 'शनि'];
const NP_MONTHS = [
  'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौं', 'असोज',
  'कात्तिक', 'मंसिर', 'पुष', 'माघ', 'फागुन', 'चैत',
];

const toNpDigits = (s: string | number) =>
  String(s).replace(/\d/g, (d) => NP_DIGITS[Number(d)]);

/** AD date → "सोम २४ भदौं" (BS weekday, day, month). Empty string when conversion fails. */
export function toBsDisplay(value?: string | Date | null): string {
  const bs = toBsDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bs)) return '';
  const [, m, d] = bs.split('-').map(Number);
  // toBsDate normalizes to Nepal-local, so derive the weekday from the same
  // Nepal-local instant rather than the viewer's machine.
  const at = typeof value === 'string' ? new Date(`${value}T00:00:00`) : (value ?? new Date());
  const npt = new Date(at.getTime() + NEPAL_OFFSET_MS);
  return `${NP_WEEKDAYS[npt.getUTCDay()]} ${toNpDigits(d)} ${NP_MONTHS[m - 1]}`;
}
