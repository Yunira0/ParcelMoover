import { describe, it, expect } from "vitest";

import {
  bsMonthRange,
  bsPeriodKey,
  bsToAdStart,
  fiscalYear,
  fiscalYearOf,
  fiscalYearPeriodKeys,
  formatBs,
  parsePeriodKey,
  periodKeyOf,
  toBs,
} from "../bikramSambat";

// Nepal is UTC+5:45, so 18:15Z is midnight NPT the next day. That boundary is
// the whole reason this module exists, and most of what is worth testing.
const NEPAL_MIDNIGHT_2026_07_17 = "2026-07-16T18:15:00.000Z";

describe("toBs / formatBs", () => {
  it("converts a known date", () => {
    expect(formatBs(new Date("2026-08-07T00:00:00Z"))).toBe("2083-04-22");
  });

  it("uses the Nepal calendar day, not the UTC one", () => {
    // 20:00Z on 16 July is 01:45 NPT on 17 July - already the new BS month.
    // Converting the raw UTC instant would report the previous day and post the
    // entry into the wrong accounting period.
    expect(formatBs(new Date("2026-07-16T20:00:00Z"))).toBe("2083-04-01");
    // Ten minutes earlier is still the day before, in both calendars.
    expect(formatBs(new Date("2026-07-16T18:05:00Z"))).toBe("2083-03-32");
  });

  it("returns 1-based months", () => {
    // Shrawan is the fourth BS month; a 0-based library index would say 3.
    expect(toBs(new Date(NEPAL_MIDNIGHT_2026_07_17))).toEqual({ year: 2083, month: 4, day: 1 });
  });

  it("zero-pads so the strings sort chronologically", () => {
    const early = formatBs(new Date("2026-04-14T06:00:00Z")); // Baishakh 1
    const late = formatBs(new Date("2026-08-07T06:00:00Z")); // Shrawan 22
    expect(early).toBe("2083-01-01");
    expect(early < late).toBe(true);
  });
});

describe("period keys", () => {
  it("derives the period an instant belongs to", () => {
    expect(bsPeriodKey(new Date("2026-08-07T06:00:00Z"))).toBe("2083-04");
  });

  it("round-trips through parsePeriodKey", () => {
    expect(parsePeriodKey(periodKeyOf(2083, 4))).toEqual({ year: 2083, month: 4 });
  });

  it("rejects malformed keys rather than guessing", () => {
    expect(() => parsePeriodKey("2083-4")).toThrow(/Invalid BS period key/);
    expect(() => parsePeriodKey("2083-13")).toThrow(/Invalid BS month/);
    expect(() => parsePeriodKey("")).toThrow(/Invalid BS period key/);
  });
});

describe("bsMonthRange", () => {
  it("spans midnight NPT to midnight NPT", () => {
    const range = bsMonthRange(2083, 4);
    expect(range.start.toISOString()).toBe(NEPAL_MIDNIGHT_2026_07_17);
    expect(range.end.toISOString()).toBe("2026-08-16T18:15:00.000Z");
  });

  it("is half-open, so consecutive months meet exactly once", () => {
    const shrawan = bsMonthRange(2083, 4);
    const bhadra = bsMonthRange(2083, 5);
    expect(shrawan.end.getTime()).toBe(bhadra.start.getTime());
    // The boundary instant belongs to the later month only.
    expect(bsPeriodKey(shrawan.end)).toBe("2083-05");
    expect(bsPeriodKey(new Date(shrawan.end.getTime() - 1))).toBe("2083-04");
  });

  it("rolls the year over at Chaitra", () => {
    const chaitra = bsMonthRange(2083, 12);
    expect(chaitra.end.getTime()).toBe(bsToAdStart(2084, 1, 1).getTime());
  });

  it("handles BS months of differing length", () => {
    // BS month lengths vary 29-32 days; nothing here may assume 30.
    const lengths = [4, 5, 9, 12].map((month) => {
      const { start, end } = bsMonthRange(2083, month);
      return Math.round((end.getTime() - start.getTime()) / 86_400_000);
    });
    for (const length of lengths) expect(length).toBeGreaterThanOrEqual(29);
    for (const length of lengths) expect(length).toBeLessThanOrEqual(32);
  });
});

describe("fiscal year", () => {
  it("opens on Shrawan 1", () => {
    const fy = fiscalYear(2083);
    expect(fy.code).toBe("2083/84");
    expect(fy.start.toISOString()).toBe(NEPAL_MIDNIGHT_2026_07_17);
    expect(fy.start.getTime()).toBe(bsToAdStart(2083, 4, 1).getTime());
    expect(fy.end.getTime()).toBe(bsToAdStart(2084, 4, 1).getTime());
  });

  it("puts Baishakh through Ashadh in the year that opened the previous Shrawan", () => {
    // Ashadh 2084 is the LAST month of FY 2083/84, not the first of 2084/85 -
    // the case a naive "fiscal year = BS year" would get wrong.
    const ashadh2084 = bsToAdStart(2084, 3, 15);
    expect(fiscalYearOf(ashadh2084).code).toBe("2083/84");

    const shrawan2084 = bsToAdStart(2084, 4, 1);
    expect(fiscalYearOf(shrawan2084).code).toBe("2084/85");
  });

  it("agrees with itself at the exact boundary", () => {
    const fy = fiscalYear(2083);
    expect(fiscalYearOf(fy.start).code).toBe("2083/84");
    expect(fiscalYearOf(new Date(fy.end.getTime() - 1)).code).toBe("2083/84");
    expect(fiscalYearOf(fy.end).code).toBe("2084/85");
  });

  it("lists its twelve periods in closing order", () => {
    expect(fiscalYearPeriodKeys(2083)).toEqual([
      "2083-04", "2083-05", "2083-06", "2083-07", "2083-08", "2083-09",
      "2083-10", "2083-11", "2083-12", "2084-01", "2084-02", "2084-03",
    ]);
  });

  it("covers the fiscal year with no gap between its periods", () => {
    const keys = fiscalYearPeriodKeys(2083);
    const ranges = keys.map((key) => {
      const { year, month } = parsePeriodKey(key);
      return bsMonthRange(year, month);
    });

    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]!.start.getTime()).toBe(ranges[index - 1]!.end.getTime());
    }
    expect(ranges[0]!.start.getTime()).toBe(fiscalYear(2083).start.getTime());
    expect(ranges[11]!.end.getTime()).toBe(fiscalYear(2083).end.getTime());
  });
});
