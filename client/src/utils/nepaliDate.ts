import NepaliDate from 'nepali-date-converter';

// Nepal Standard Time is a fixed UTC+5:45 (no DST). ISO timestamps are shifted
// by it before taking the calendar day, so the BS date matches Nepal's day
// regardless of the viewer's machine timezone. Server-produced "YYYY-MM-DD"
// strings are already Nepal-local and are converted as-is.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

export const BS_MONTHS = [
  'Baishakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
] as const;

type BsParts = { year: number; month: number; day: number } | null;

function bsParts(value?: string | Date | null): BsParts {
  if (!value) return null;

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
      if (isNaN(at.getTime())) return null;
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
    // Tolerate minor API differences between nepali-date-converter versions.
    const AnyNepali = NepaliDate as any;
    const ad = new Date(y, m - 1, d);
    const nd = AnyNepali.fromAD ? AnyNepali.fromAD(ad) : new AnyNepali(ad);
    const bs = nd.getBS
      ? nd.getBS()
      : { year: nd.getYear(), month: nd.getMonth(), date: nd.getDate() };
    return { year: bs.year, month: bs.month + 1, day: bs.date };
  } catch {
    // Out of the converter's supported range - fall back to the AD value.
    return null;
  }
}

/** AD date (ISO timestamp, "YYYY-MM-DD", or Date) → BS "YYYY-MM-DD". Falls back to the input. */
export function toBsDate(value?: string | Date | null): string {
  const bs = bsParts(value);
  if (!bs) return typeof value === 'string' ? value : '';
  return `${bs.year}-${pad(bs.month)}-${pad(bs.day)}`;
}

/** BS date with the month spelled out, e.g. "21 Asar 2082". */
export function toBsDateLabel(value?: string | Date | null): string {
  const bs = bsParts(value);
  if (!bs) return typeof value === 'string' ? value : '';
  return `${bs.day} ${BS_MONTHS[bs.month - 1]} ${bs.year}`;
}

type BsDayParts = { year: number; monthIndex: number; day: number };

/**
 * AD "YYYY-MM-DD" (a Nepal-local calendar day) → BS parts (monthIndex is 0-11),
 * or null when the value is not a plain day string or falls outside the
 * converter's supported range.
 */
export function adDayToBsParts(ad?: string | null): BsDayParts | null {
  if (!ad) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ad.trim());
  if (!m) return null;
  try {
    const AnyNepali = NepaliDate as any;
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const nd = AnyNepali.fromAD ? AnyNepali.fromAD(at) : new AnyNepali(at);
    const bs = nd.getBS
      ? nd.getBS()
      : { year: nd.getYear(), month: nd.getMonth(), date: nd.getDate() };
    return { year: bs.year, monthIndex: bs.month, day: bs.date };
  } catch {
    return null;
  }
}

/** BS (year, monthIndex 0-11, day) → AD "YYYY-MM-DD" Nepal-local calendar day. */
export function bsToAdDay(year: number, monthIndex: number, day: number): string {
  const jd = new (NepaliDate as any)(year, monthIndex, day).toJsDate() as Date;
  return `${jd.getFullYear()}-${pad(jd.getMonth() + 1)}-${pad(jd.getDate())}`;
}

/** Number of days (30-32) in a BS month. */
export function bsDaysInMonth(year: number, monthIndex: number): number {
  const AnyNepali = NepaliDate as any;
  const start = new AnyNepali(year, monthIndex, 1).toJsDate() as Date;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = (monthIndex + 1) % 12;
  const next = new AnyNepali(nextYear, nextMonth, 1).toJsDate() as Date;
  return Math.round((next.getTime() - start.getTime()) / 86_400_000);
}

/** Weekday index (0=Sunday) of BS (year, monthIndex, day). */
export function bsWeekday(year: number, monthIndex: number, day: number): number {
  return (new (NepaliDate as any)(year, monthIndex, day).toJsDate() as Date).getDay();
}

/** Today's date as BS parts (monthIndex is 0-11). */
export function todayBsParts(): BsDayParts {
  const AnyNepali = NepaliDate as any;
  const nd = AnyNepali.now ? AnyNepali.now() : new AnyNepali();
  const bs = nd.getBS
    ? nd.getBS()
    : { year: nd.getYear(), month: nd.getMonth(), date: nd.getDate() };
  return { year: bs.year, monthIndex: bs.month, day: bs.date };
}

/** Nepal clock time for a timestamp, e.g. "19:53" or "19:53:44". */
export function toNptTime(value?: string | Date | null, withSeconds = false): string {
  if (!value) return '';
  const at = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(at.getTime())) return '';
  return at.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kathmandu',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
  });
}
