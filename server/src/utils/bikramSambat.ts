// Bikram Sambat (BS) calendar support for the accounting ledger.
//
// The books are kept in BS: an accounting period is a BS month, and a fiscal
// year runs Shrawan 1 -> Ashadh end. Every timestamp in the database stays AD
// (timestamptz) - BS is derived here, never stored as the source of truth, so
// the two can never disagree.
//
// Conversion is anchored to the *Nepal* calendar day, not the host's. The
// nepali-date-converter library reads a JS Date through its local getters, so
// feeding it a raw UTC instant would silently shift the result by the server's
// own timezone: an order delivered at 02:00 NPT would land on the previous BS
// day on a UTC host, and the entry would post into the wrong period. We
// therefore resolve the Nepal-local Y/M/D first (the same UTC+5:45 shift
// nepalTime.ts uses), then hand the library a Date carrying exactly those
// calendar parts.
import NepaliDateCtor from "nepali-date-converter";
import { NEPAL_UTC_OFFSET_MS } from "./nepalTime";

// The package ships a UMD bundle whose default export is the class; under
// CommonJS that arrives either directly or behind `.default` depending on the
// interop path. Normalising once here keeps the rest of the file honest.
const NepaliDate = ((NepaliDateCtor as unknown as { default?: typeof NepaliDateCtor }).default ??
  NepaliDateCtor) as typeof NepaliDateCtor;

/** A BS calendar date. `month` is 1-based: 1 = Baishakh ... 12 = Chaitra. */
export interface BsDate {
  year: number;
  /** 1-based, 1 = Baishakh. */
  month: number;
  day: number;
}

/** BS month index (1-based) the fiscal year opens on. */
export const FISCAL_YEAR_START_MONTH = 4; // Shrawan

export const BS_MONTH_NAMES = [
  "Baishakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

// ── AD -> BS ────────────────────────────────────────────────────────────────

/** The Nepal-local calendar date (AD) an instant falls on. */
function nepalCalendarParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + NEPAL_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * BS date for an instant, resolved on the Nepal calendar day.
 *
 * Deterministic on any host timezone: the intermediate Date is built from the
 * Nepal-local parts at local noon, which is far enough from either midnight
 * that no offset or DST rule on the host can push it onto an adjacent day.
 */
export function toBs(date: Date): BsDate {
  const { year, month, day } = nepalCalendarParts(date);
  const nepali = new NepaliDate(new Date(year, month - 1, day, 12, 0, 0, 0));
  return { year: nepali.getYear(), month: nepali.getMonth() + 1, day: nepali.getDate() };
}

/** `2083-04-22`. Zero-padded so the strings sort chronologically. */
export function formatBs(date: Date): string {
  const bs = toBs(date);
  return `${bs.year}-${String(bs.month).padStart(2, "0")}-${String(bs.day).padStart(2, "0")}`;
}

/** `2083-04` - the accounting period key an instant belongs to. */
export function bsPeriodKey(date: Date): string {
  const bs = toBs(date);
  return periodKeyOf(bs.year, bs.month);
}

export function periodKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Splits `2083-04` back into its parts. Throws on anything malformed. */
export function parsePeriodKey(key: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid BS period key: ${key}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid BS month in period key: ${key}`);
  return { year, month };
}

// ── BS -> AD ────────────────────────────────────────────────────────────────

/** The UTC instant of Nepal-local midnight starting the given BS date. */
export function bsToAdStart(year: number, month: number, day: number): Date {
  const ad = new NepaliDate(year, month - 1, day).getAD();
  return new Date(Date.UTC(ad.year, ad.month, ad.date) - NEPAL_UTC_OFFSET_MS);
}

/**
 * Half-open AD range `[start, end)` covering one BS month - the form every
 * period query wants, since `created_at >= start AND created_at < end` needs no
 * knowledge of how many days that BS month happens to have (they vary 29-32,
 * and the table is revised year to year).
 */
export function bsMonthRange(year: number, month: number): { start: Date; end: Date } {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: bsToAdStart(year, month, 1), end: bsToAdStart(nextYear, nextMonth, 1) };
}

// ── Fiscal year ─────────────────────────────────────────────────────────────

export interface BsFiscalYear {
  /** Opening BS year, e.g. 2083 for the year running Shrawan 2083 -> Ashadh 2084. */
  startYear: number;
  /** `2083/84`, the form it is written and spoken in. */
  code: string;
  /** AD range, half-open. */
  start: Date;
  end: Date;
}

export function fiscalYearOf(date: Date): BsFiscalYear {
  const bs = toBs(date);
  // Baishakh, Jestha and Ashadh (months 1-3) still belong to the fiscal year
  // that opened the previous Shrawan.
  const startYear = bs.month >= FISCAL_YEAR_START_MONTH ? bs.year : bs.year - 1;
  return fiscalYear(startYear);
}

export function fiscalYear(startYear: number): BsFiscalYear {
  return {
    startYear,
    code: `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`,
    start: bsToAdStart(startYear, FISCAL_YEAR_START_MONTH, 1),
    end: bsToAdStart(startYear + 1, FISCAL_YEAR_START_MONTH, 1),
  };
}

/** The twelve period keys of a fiscal year, in the order they are closed. */
export function fiscalYearPeriodKeys(startYear: number): string[] {
  return Array.from({ length: 12 }, (_, offset) => {
    const monthIndex = FISCAL_YEAR_START_MONTH - 1 + offset;
    return periodKeyOf(startYear + Math.floor(monthIndex / 12), (monthIndex % 12) + 1);
  });
}
