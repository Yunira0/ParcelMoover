// Nepal Standard Time is a fixed UTC+5:45 offset (no DST). Shifting by it
// before truncating to a calendar day keeps the reported "day" aligned with
// Nepal local time regardless of the server host's own timezone - without
// this, records created between midnight and 5:45am NPT get bucketed into
// the previous UTC day, one day off from what a user filtering "today" expects.
export const NEPAL_UTC_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

export const formatNepalDate = (date?: Date | null) =>
  date ? new Date(date.getTime() + NEPAL_UTC_OFFSET_MS).toISOString().slice(0, 10) : "";
