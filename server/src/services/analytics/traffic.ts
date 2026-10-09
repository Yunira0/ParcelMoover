// Request counts for `pm-stats api`, `vendors` and `live`.
//
// Each finished /api request adds to in-memory counters; every 10 seconds they
// go to Redis in one pipeline (HINCRBY, so both release slots add up). Stored
// per UTC minute (kept 2 days) and per UTC hour (kept 8 days), with a latency
// histogram per route so the reader can estimate p50 / p95.
//
// Partner API calls are also counted per API key per Nepal day (kept 40 days).
//
// Redis here runs without persistence: a Redis restart starts these counts
// over. That is acceptable for traffic numbers; people counts live in Postgres.

import redis from "../../lib/redis";
import {
  API_KEY_LAST_CALL_KEY, apiKeyDayKey, bucketIndex, hourKey, minuteKey, nepalDay, RECENT_ERRORS_KEY,
  type TrafficApp,
} from "./trafficKeys";

const RECENT_ERRORS_KEPT = 50;
const TTL_SECONDS = { m: 2 * 86_400, h: 8 * 86_400, d: 40 * 86_400 } as const;
const FLUSH_INTERVAL_MS = 10_000;

export type RequestSample = {
  at: Date;
  app: TrafficApp;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  apiKeyId?: string | undefined;
};

const pending = new Map<string, Map<string, number>>();
const pendingLastCall = new Map<string, number>();
const pendingErrors: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushErrorLogged = false;

function add(key: string, field: string): void {
  let fields = pending.get(key);
  if (!fields) pending.set(key, (fields = new Map()));
  fields.set(field, (fields.get(field) ?? 0) + 1);
}

export function recordRequest(sample: RequestSample): void {
  const { at, app, status } = sample;
  const route = `${sample.method} ${sample.route}`;
  const bucket = bucketIndex(sample.durationMs);
  const fields = [`req|${app}`, `b${bucket}|${app}`, `r|${route}|n`, `r|${route}|b${bucket}`];
  if (status >= 500) fields.push(`5xx|${app}`, `r|${route}|e`);
  for (const key of [minuteKey(at), hourKey(at)]) {
    for (const field of fields) add(key, field);
  }

  if (sample.apiKeyId) {
    const dayKey = apiKeyDayKey(nepalDay(at));
    add(dayKey, `${sample.apiKeyId}|n`);
    if (status >= 400) {
      add(dayKey, `${sample.apiKeyId}|fail`);
      add(dayKey, `${sample.apiKeyId}|s${status}`);
    }
    pendingLastCall.set(sample.apiKeyId, at.getTime());
  }

  if (status >= 500) {
    pendingErrors.push(JSON.stringify({ at: at.toISOString(), status, method: sample.method, route: sample.route }));
  }

  if (!flushTimer) {
    flushTimer = setInterval(() => void flushTraffic(), FLUSH_INTERVAL_MS);
    flushTimer.unref();
  }
}

export async function flushTraffic(): Promise<void> {
  if (pending.size === 0 && pendingLastCall.size === 0 && pendingErrors.length === 0) return;
  // Take the batch first: if Redis is down it is dropped, never retried, so
  // memory stays bounded.
  const batch = [...pending];
  pending.clear();
  const lastCalls = [...pendingLastCall];
  pendingLastCall.clear();
  const errors = pendingErrors.splice(0);

  const pipeline = redis.pipeline();
  for (const [key, fields] of batch) {
    for (const [field, count] of fields) pipeline.hincrby(key, field, count);
    pipeline.expire(key, TTL_SECONDS[key.startsWith("pm:apikeys:d:") ? "d" : key.startsWith("pm:traffic:h:") ? "h" : "m"]);
  }
  for (const [keyId, at] of lastCalls) pipeline.hset(API_KEY_LAST_CALL_KEY, keyId, String(at));
  if (errors.length > 0) {
    pipeline.lpush(RECENT_ERRORS_KEY, ...errors);
    pipeline.ltrim(RECENT_ERRORS_KEY, 0, RECENT_ERRORS_KEPT - 1);
  }

  try {
    await pipeline.exec();
    flushErrorLogged = false;
  } catch (error) {
    if (!flushErrorLogged) {
      console.error("[Analytics] Failed to save request counts (further failures suppressed):", error);
      flushErrorLogged = true;
    }
  }
}
