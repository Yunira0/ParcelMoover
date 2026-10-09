// Where request counts live in Redis, shared by the recorder (traffic.ts) and
// the pm-stats readers. No Redis client here, so the CLI can use its own.

export const TRAFFIC_APPS = ["dashboard", "rider", "partner"] as const;
export type TrafficApp = (typeof TRAFFIC_APPS)[number];

// Upper bounds in ms; one more bucket above the last for anything slower.
export const LATENCY_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2000, 5000] as const;

export const RECENT_ERRORS_KEY = "pm:traffic:errors";
export const API_KEY_LAST_CALL_KEY = "pm:apikeys:last";

export const minuteKey = (at: Date) => `pm:traffic:m:${utcStamp(at, 12)}`;
export const hourKey = (at: Date) => `pm:traffic:h:${utcStamp(at, 10)}`;
export const apiKeyDayKey = (nepalDay: string) => `pm:apikeys:d:${nepalDay}`;

// "202610090847" (minute) / "2026100908" (hour), UTC.
function utcStamp(at: Date, length: number): string {
  return at.toISOString().replace(/[-:T]/g, "").slice(0, length);
}

export function nepalDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(at);
}

export function bucketIndex(durationMs: number): number {
  const index = LATENCY_BUCKETS_MS.findIndex((upper) => durationMs <= upper);
  return index === -1 ? LATENCY_BUCKETS_MS.length : index;
}
