// Copies pm-stats request counts from Redis into Postgres (analytics_counters)
// so a Redis restart does not erase history. Runs every 5 minutes from
// index.ts; both release slots may run it, which is harmless.
//
// Copied: the current and previous hour (totals, errors and speed by app;
// calls and errors per request type), today's and yesterday's Partner API
// calls per key, and each key's last call. Per-request-type speed detail is
// left in Redis only (kept 8 days) to keep this table small.
//
// A count never goes down here (GREATEST): after a Redis restart the fresh
// Redis count for that hour starts from zero and must not overwrite it.

import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { API_KEY_LAST_CALL_KEY, apiKeyDayKey, hourKey, nepalDay } from "./trafficKeys";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const KEEP_DAYS = 90;

// Which fields of a Redis hash are worth keeping.
export function keepField(bucket: string, field: string): boolean {
  if (!bucket.startsWith("pm:traffic:h:")) return true;
  if (/^(req|5xx|b\d+)\|/.test(field)) return true;
  return field.startsWith("r|") && (field.endsWith("|n") || field.endsWith("|e"));
}

export function bucketsToCopy(now: Date): string[] {
  return [
    hourKey(now),
    hourKey(new Date(now.getTime() - HOUR_MS)),
    apiKeyDayKey(nepalDay(now)),
    apiKeyDayKey(nepalDay(new Date(now.getTime() - DAY_MS))),
    API_KEY_LAST_CALL_KEY,
  ];
}

export async function persistCounters(now = new Date()): Promise<number> {
  const buckets = bucketsToCopy(now);
  const pipeline = redis.pipeline();
  for (const bucket of buckets) pipeline.hgetall(bucket);
  const results = (await pipeline.exec()) ?? [];

  const rows = { bucket: [] as string[], field: [] as string[], count: [] as string[] };
  buckets.forEach((bucket, i) => {
    const hash = (results[i]?.[1] as Record<string, string> | undefined) ?? {};
    for (const [field, value] of Object.entries(hash)) {
      if (!keepField(bucket, field) || !/^\d+$/.test(value)) continue;
      rows.bucket.push(bucket);
      rows.field.push(field);
      rows.count.push(value);
    }
  });
  if (rows.bucket.length === 0) return 0;

  await prisma.$executeRaw(buildUpsertQuery(rows));
  return rows.bucket.length;
}

export function buildUpsertQuery(rows: { bucket: string[]; field: string[]; count: string[] }): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO analytics_counters (bucket, field, count)
    SELECT * FROM unnest(${rows.bucket}::text[], ${rows.field}::text[], ${rows.count}::bigint[])
    ON CONFLICT (bucket, field) DO UPDATE
      SET count = GREATEST(analytics_counters.count, EXCLUDED.count), updated_at = now()`;
}

export function buildDeleteOldQuery(): Prisma.Sql {
  return Prisma.sql`DELETE FROM analytics_counters WHERE updated_at < now() - make_interval(days => ${KEEP_DAYS})`;
}

export async function deleteOldCounters(): Promise<number> {
  return prisma.$executeRaw(buildDeleteOldQuery());
}
