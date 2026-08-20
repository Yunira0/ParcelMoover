// Nepal Standard Time is a fixed UTC+5:45 offset (no DST). Shifting by it
// before truncating to a calendar day keeps the reported "day" aligned with
// Nepal local time regardless of the server host's own timezone - without
// this, records created between midnight and 5:45am NPT get bucketed into
// the previous UTC day, one day off from what a user filtering "today" expects.
export const NEPAL_UTC_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/**
 * The UTC instants bounding an inclusive range of Nepal-local days, given as
 * "YYYY-MM-DD" (what NepaliDatePicker emits).
 *
 * A Nepal day starts 5h45m before UTC midnight, so comparing a timestamptz
 * column against bare UTC midnight both shifts the window and - for the `to`
 * bound - drops the whole final day. `lt` is the *next* day's Nepal midnight,
 * which is what makes the range inclusive of `toDay`.
 */
export function nepalDayRangeUtc(
  fromDay?: string,
  toDay?: string,
): { gte?: Date; lt?: Date } {
  const range: { gte?: Date; lt?: Date } = {};
  const utcMidnight = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

  if (fromDay) {
    const t = utcMidnight(fromDay);
    if (!Number.isNaN(t)) range.gte = new Date(t - NEPAL_UTC_OFFSET_MS);
  }
  if (toDay) {
    const t = utcMidnight(toDay);
    if (!Number.isNaN(t)) range.lt = new Date(t - NEPAL_UTC_OFFSET_MS + 24 * 60 * 60 * 1000);
  }
  return range;
}

export const formatNepalDate = (date?: Date | null) =>
  date ? new Date(date.getTime() + NEPAL_UTC_OFFSET_MS).toISOString().slice(0, 10) : "";
