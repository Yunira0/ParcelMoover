import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted because vi.mock is, and the factory below closes over it.
const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("../../lib/prisma", () => ({ default: { $queryRaw: queryRaw }, pool: {} }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() }, scanAndDelete: vi.fn() }));

import { getProfitAndLoss } from "../accounting/accounting.service";

// Every report in the service is the same aggregate with a different window, so
// the window is the thing worth testing. It was silently a no-op once: the date
// filter sat on a LEFT JOIN to journal_entries, which removes no rows from the
// left side, and `SUM(l.debit)` went on counting lines from every other month.
// A profit and loss statement for Shrawan reported the whole year's revenue and
// looked entirely plausible doing it.
//
// These assert the shape of the SQL rather than its result, because that is
// where the bug was - the numbers were arithmetically correct sums of the wrong
// rows.

/** The one query accountTotals issues, as Prisma received it. */
function capturedSql(): string {
  expect(queryRaw).toHaveBeenCalledTimes(1);
  return String(queryRaw.mock.calls[0]![0].sql).replace(/\s+/g, " ");
}

describe("report windows", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
  });

  it("constrains the lines themselves, not a left-joined entries table", async () => {
    await getProfitAndLoss({ period: "2083-04" });
    const sql = capturedSql();

    expect(sql).toMatch(/LEFT JOIN journal_lines l ON l\.account_id = a\.id AND l\.entry_date </);
    expect(sql).toContain("AND l.entry_date >=");
  });

  it("never reintroduces the join whose filter did nothing", async () => {
    await getProfitAndLoss({ period: "2083-04" });
    expect(capturedSql()).not.toContain("LEFT JOIN journal_entries");
  });

  it("passes both ends of the period as bound parameters", async () => {
    await getProfitAndLoss({ period: "2083-04" });

    const values = queryRaw.mock.calls[0]![0].values as unknown[];
    const dates = values.filter((value): value is Date => value instanceof Date);
    expect(dates).toHaveLength(2);

    // Shrawan 2083 - a real BS month, resolved through the calendar rather than
    // hardcoded here, so this checks ordering and not the conversion.
    const [to, from] = dates[0]! < dates[1]! ? [dates[1]!, dates[0]!] : [dates[0]!, dates[1]!];
    expect(from.getTime()).toBeLessThan(to.getTime());
    // A BS month is 29-32 days; anything outside that means the window is not
    // one month.
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(32);
  });

  it("leaves the opening end unbounded when asked for a position rather than a period", async () => {
    // A balance sheet asks "as at", not "during": no lower bound, or the
    // closing position would be a period subtotal wearing its name.
    await getProfitAndLoss({ from: "2026-08-01", to: "2026-08-07" });
    expect(capturedSql()).toContain("AND l.entry_date >=");

    queryRaw.mockClear();
    const { getBalanceSheet } = await import("../accounting/accounting.service");
    await getBalanceSheet({ period: "2083-04" });
    expect(capturedSql()).not.toContain("AND l.entry_date >=");
  });
});
