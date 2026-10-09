// Numbers behind `pm-stats api`: traffic, speed and errors from the request
// counts in Redis (see ../traffic.ts). Read-only.

import type Redis from "ioredis";
import {
  hourKey, LATENCY_BUCKETS_MS, minuteKey, RECENT_ERRORS_KEY, TRAFFIC_APPS, type TrafficApp,
} from "../trafficKeys";
import { getServerStats, type ServerStats } from "./server";

export const API_WINDOWS = {
  "1h": { slots: 60, slotMs: 60_000, key: minuteKey, label: "last 1 hour" },
  "24h": { slots: 24, slotMs: 3_600_000, key: hourKey, label: "last 24 hours" },
  "7d": { slots: 168, slotMs: 3_600_000, key: hourKey, label: "last 7 days" },
} as const;
export type ApiWindow = keyof typeof API_WINDOWS;

export type Totals = { requests: number; errors: number; buckets: number[] };
export type RouteTotals = Totals & { route: string };
export type TrafficSummary = {
  overall: Totals;
  apps: Record<TrafficApp, Totals>;
  routes: RouteTotals[];
  // Requests per slot (minute or hour), oldest first.
  series: number[];
};

const emptyTotals = (): Totals => ({ requests: 0, errors: 0, buckets: Array(LATENCY_BUCKETS_MS.length + 1).fill(0) });

// One Redis hash per slot, oldest first; a missing slot is an empty object.
export function summarize(slots: Record<string, string>[]): TrafficSummary {
  const apps = Object.fromEntries(TRAFFIC_APPS.map((app) => [app, emptyTotals()])) as Record<TrafficApp, Totals>;
  const routes = new Map<string, RouteTotals>();
  const series: number[] = [];

  for (const fields of slots) {
    let slotRequests = 0;
    for (const [field, raw] of Object.entries(fields)) {
      const count = Number(raw) || 0;
      const first = field.indexOf("|");
      const last = field.lastIndexOf("|");
      const kind = field.slice(0, first);
      if (kind === "r") {
        const route = field.slice(first + 1, last);
        const part = field.slice(last + 1);
        let totals = routes.get(route);
        if (!totals) routes.set(route, (totals = { route, ...emptyTotals() }));
        addTo(totals, part, count);
        continue;
      }
      const app = field.slice(first + 1) as TrafficApp;
      if (!apps[app]) continue;
      addTo(apps[app], kind, count);
      if (kind === "req") slotRequests += count;
    }
    series.push(slotRequests);
  }

  const overall = emptyTotals();
  for (const app of TRAFFIC_APPS) {
    overall.requests += apps[app].requests;
    overall.errors += apps[app].errors;
    apps[app].buckets.forEach((n, i) => (overall.buckets[i]! += n));
  }
  return { overall, apps, routes: [...routes.values()], series };
}

function addTo(totals: Totals, part: string, count: number): void {
  if (part === "req" || part === "n") totals.requests += count;
  else if (part === "5xx" || part === "e") totals.errors += count;
  else if (part.startsWith("b")) {
    const index = Number(part.slice(1));
    if (index >= 0 && index < totals.buckets.length) totals.buckets[index]! += count;
  }
}

// Estimated from the histogram, interpolating inside the bucket. null = no
// requests; Infinity = beyond the last bucket (over 5 s).
export function percentileMs(buckets: number[], p: number): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = p * total;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    const inBucket = buckets[i]!;
    if (inBucket > 0 && seen + inBucket >= target) {
      if (i >= LATENCY_BUCKETS_MS.length) return Infinity;
      const lower = i === 0 ? 0 : LATENCY_BUCKETS_MS[i - 1]!;
      return lower + ((target - seen) / inBucket) * (LATENCY_BUCKETS_MS[i]! - lower);
    }
    seen += inBucket;
  }
  return Infinity;
}

export type RecentError = { at: string; status: number; method: string; route: string };

export type ApiReport = {
  asOf: string;
  window: ApiWindow;
  from: string;
  summary: TrafficSummary;
  recentErrors: RecentError[];
  server: ServerStats;
  redisError: string | null;
};

export function windowKeys(window: ApiWindow, now: Date): { keys: string[]; from: Date } {
  const { slots, slotMs, key } = API_WINDOWS[window];
  const from = new Date(now.getTime() - (slots - 1) * slotMs);
  return {
    from,
    keys: Array.from({ length: slots }, (_, i) => key(new Date(from.getTime() + i * slotMs))),
  };
}

export async function getApiReport(redis: Redis, window: ApiWindow): Promise<ApiReport> {
  const now = new Date();
  const { keys, from } = windowKeys(window, now);
  let slots: Record<string, string>[] = keys.map(() => ({}));
  let recentErrors: RecentError[] = [];
  let redisError: string | null = null;

  try {
    const pipeline = redis.pipeline();
    for (const key of keys) pipeline.hgetall(key);
    pipeline.lrange(RECENT_ERRORS_KEY, 0, 9);
    const results = (await pipeline.exec()) ?? [];
    slots = keys.map((_, i) => (results[i]?.[1] as Record<string, string> | undefined) ?? {});
    recentErrors = ((results[keys.length]?.[1] as string[] | undefined) ?? []).flatMap((raw) => {
      try {
        return [JSON.parse(raw) as RecentError];
      } catch {
        return [];
      }
    });
  } catch (error) {
    redisError = error instanceof Error ? error.message : String(error);
  }

  return {
    asOf: now.toISOString(),
    window,
    from: from.toISOString(),
    summary: summarize(slots),
    recentErrors,
    server: await getServerStats(redis),
    redisError,
  };
}
