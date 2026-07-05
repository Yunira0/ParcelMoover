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
