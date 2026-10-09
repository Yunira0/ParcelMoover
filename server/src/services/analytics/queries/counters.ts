// Reads pm-stats counts: Redis first, and for any bucket Redis no longer has
// (expired, or lost in a Redis restart) the Postgres copy in
// analytics_counters (see ../persist.ts). Read-only.

import type Redis from "ioredis";
import { Prisma } from "../../../generated/prisma/client";
import prisma from "../../../lib/prisma";

type Hash = Record<string, string>;

async function readRedis(redis: Redis, buckets: string[]): Promise<{ hashes: Hash[]; redisError: string | null }> {
  try {
    const pipeline = redis.pipeline();
    for (const bucket of buckets) pipeline.hgetall(bucket);
    const results = (await pipeline.exec()) ?? [];
    return { hashes: buckets.map((_, i) => (results[i]?.[1] as Hash | undefined) ?? {}), redisError: null };
  } catch (error) {
    return { hashes: buckets.map(() => ({})), redisError: error instanceof Error ? error.message : String(error) };
  }
}

const isEmpty = (hash: Hash) => Object.keys(hash).length === 0;

export function buildCopiesQuery(buckets: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT bucket, field, count::text AS count FROM analytics_counters WHERE bucket = ANY(${buckets}::text[])`;
}

// A few small hashes (Partner API days, last calls): every field, per bucket.
export async function readBuckets(redis: Redis, buckets: string[]): Promise<{ hashes: Hash[]; redisError: string | null }> {
  const { hashes, redisError } = await readRedis(redis, buckets);
  const missing = buckets.filter((_, i) => isEmpty(hashes[i]!));
  if (missing.length > 0) {
    const rows = await prisma.$queryRaw<{ bucket: string; field: string; count: string }[]>(buildCopiesQuery(missing));
    for (const row of rows) hashes[buckets.indexOf(row.bucket)]![row.field] = row.count;
  }
  return { hashes, redisError };
}

// Requests per app, per bucket: enough for the trend line.
export function buildRequestsPerBucketQuery(buckets: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT bucket, field, count::text AS count FROM analytics_counters
    WHERE bucket = ANY(${buckets}::text[]) AND field LIKE 'req|%'`;
}

// Everything else, added up across the buckets by Postgres.
export function buildTotalsQuery(buckets: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT field, SUM(count)::text AS count FROM analytics_counters
    WHERE bucket = ANY(${buckets}::text[]) AND field NOT LIKE 'req|%'
    GROUP BY field`;
}

// Traffic slots for a time window, oldest first. Buckets Redis still has come
// whole from Redis. For the rest, each slot gets its request counts (for the
// trend), and `extra` holds their other counts already summed, to be added to
// the totals once.
export async function readTrafficSlots(
  redis: Redis,
  buckets: string[],
): Promise<{ slots: Hash[]; extra: Hash; redisError: string | null }> {
  const { hashes: slots, redisError } = await readRedis(redis, buckets);
  const missing = buckets.filter((bucket, i) => isEmpty(slots[i]!) && !bucket.startsWith("pm:traffic:m:"));
  const extra: Hash = {};
  if (missing.length > 0) {
    const [perBucket, totals] = await Promise.all([
      prisma.$queryRaw<{ bucket: string; field: string; count: string }[]>(buildRequestsPerBucketQuery(missing)),
      prisma.$queryRaw<{ field: string; count: string }[]>(buildTotalsQuery(missing)),
    ]);
    for (const row of perBucket) slots[buckets.indexOf(row.bucket)]![row.field] = row.count;
    for (const row of totals) extra[row.field] = row.count;
  }
  return { slots, extra, redisError };
}
