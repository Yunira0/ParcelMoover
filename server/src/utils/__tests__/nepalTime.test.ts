import { describe, it, expect } from "vitest";

import { formatNepalDate, nepalDayRangeUtc } from "../nepalTime";

describe("nepalDayRangeUtc", () => {
  // A Nepal day runs 00:00-24:00 NPT, which is 18:15Z the previous day to
  // 18:15Z on the day itself.
  it("bounds a single day at Nepal midnight, not UTC midnight", () => {
    const range = nepalDayRangeUtc("2026-08-20", "2026-08-20");
    expect(range.gte?.toISOString()).toBe("2026-08-19T18:15:00.000Z");
    expect(range.lt?.toISOString()).toBe("2026-08-20T18:15:00.000Z");
  });

  // The bug this replaces: `lte: new Date("2026-08-20")` is that day's UTC
  // midnight, so everything actually recorded on the 20th fell outside it.
  it("includes the whole of the end day", () => {
    const { lt } = nepalDayRangeUtc(undefined, "2026-08-20");
    // 23:59 NPT on the 20th is 18:14Z on the 20th - inside the range.
    const lastMomentOfDay = new Date("2026-08-20T18:14:59.000Z");
    expect(lastMomentOfDay < lt!).toBe(true);
  });

  // Anything recorded between midnight and 5:45am NPT is on the UTC day before,
  // which is what used to push it into the previous bucket.
  it("keeps an early-morning Nepal timestamp on its own day", () => {
    const range = nepalDayRangeUtc("2026-08-20", "2026-08-20");
    const oneAmNepal = new Date("2026-08-19T19:15:00.000Z");
    expect(formatNepalDate(oneAmNepal)).toBe("2026-08-20");
    expect(oneAmNepal >= range.gte!).toBe(true);
    expect(oneAmNepal < range.lt!).toBe(true);
  });

  it("spans a multi-day range", () => {
    const range = nepalDayRangeUtc("2026-08-18", "2026-08-20");
    expect(range.gte?.toISOString()).toBe("2026-08-17T18:15:00.000Z");
    expect(range.lt?.toISOString()).toBe("2026-08-20T18:15:00.000Z");
  });

  it("leaves an open end open", () => {
    expect(nepalDayRangeUtc("2026-08-20", undefined).lt).toBeUndefined();
    expect(nepalDayRangeUtc(undefined, "2026-08-20").gte).toBeUndefined();
    expect(nepalDayRangeUtc()).toEqual({});
  });

  it("ignores an unparseable day rather than producing an Invalid Date bound", () => {
    expect(nepalDayRangeUtc("not-a-date", "also-not")).toEqual({});
  });
});
