// Numbers behind `pm-stats vendors`: Partner API calls per key today (Redis,
// see ../traffic.ts) and webhook delivery health (Postgres). Read-only.

import type Redis from "ioredis";
import { Prisma } from "../../../generated/prisma/client";
import prisma from "../../../lib/prisma";
import { API_KEY_LAST_CALL_KEY, apiKeyDayKey, nepalDay } from "../trafficKeys";
import { readBuckets } from "./counters";

const nepalMidnight = Prisma.sql`((now() AT TIME ZONE 'Asia/Kathmandu')::date)::timestamp AT TIME ZONE 'Asia/Kathmandu'`;

export type KeyCalls = { calls: number; failed: number; statuses: Record<string, number> };

// "<keyId>|n", "<keyId>|fail", "<keyId>|s422" → per key.
export function parseKeyDay(fields: Record<string, string>): Map<string, KeyCalls> {
  const keys = new Map<string, KeyCalls>();
  for (const [field, raw] of Object.entries(fields)) {
    const [keyId, part] = field.split("|");
    if (!keyId || !part) continue;
    let entry = keys.get(keyId);
    if (!entry) keys.set(keyId, (entry = { calls: 0, failed: 0, statuses: {} }));
    const count = Number(raw) || 0;
    if (part === "n") entry.calls += count;
    else if (part === "fail") entry.failed += count;
    else if (part.startsWith("s")) entry.statuses[part.slice(1)] = (entry.statuses[part.slice(1)] ?? 0) + count;
  }
  return keys;
}

export function buildKeyDetailsQuery(keyIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT k.id, k.key_prefix, k.vendor_id, k.revoked_at IS NOT NULL AS revoked,
           COALESCE(NULLIF(v.business_name, ''), u.full_name, 'Unnamed vendor') AS vendor
    FROM api_keys k
    JOIN vendors v ON v.id = k.vendor_id
    LEFT JOIN users u ON u.id = v.user_id
    WHERE k.id = ANY(${keyIds}::uuid[])`;
}

// Today's deliveries per vendor. "Retrying" = still pending after a failed try.
export function buildWebhookHealthQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT e.vendor_id,
           COALESCE(NULLIF(v.business_name, ''), u.full_name, 'Unnamed vendor') AS vendor,
           COUNT(*) FILTER (WHERE d.status = 'succeeded')::int AS delivered,
           COUNT(*) FILTER (WHERE d.status = 'pending' AND d.attempt_count > 0)::int AS retrying,
           COUNT(*) FILTER (WHERE d.status = 'failed')::int AS failed,
           (array_agg(d.last_status_code ORDER BY d.last_attempted_at DESC NULLS LAST)
              FILTER (WHERE d.status <> 'succeeded' AND d.attempt_count > 0))[1] AS last_failure_code,
           MIN(d.created_at) FILTER (WHERE d.status <> 'succeeded' AND d.attempt_count > 0) AS failing_since
    FROM webhook_deliveries d
    JOIN webhook_endpoints e ON e.id = d.webhook_endpoint_id
    JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN users u ON u.id = v.user_id
    WHERE d.created_at >= ${nepalMidnight}
    GROUP BY e.vendor_id, v.business_name, u.full_name`;
}

export function buildDisabledEndpointsQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(NULLIF(v.business_name, ''), u.full_name, 'Unnamed vendor') AS vendor, e.name, e.disabled_at
    FROM webhook_endpoints e
    JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN users u ON u.id = v.user_id
    WHERE e.disabled_at IS NOT NULL AND e.disabled_at > now() - interval '7 days'
    ORDER BY e.disabled_at DESC`;
}

export type KeyRow = KeyCalls & {
  keyId: string;
  vendorId: string | null;
  vendor: string;
  keyPrefix: string;
  revoked: boolean;
  lastCallAt: string | null;
  yesterdayCalls: number;
};

export type WebhookHealth = {
  vendorId: string;
  vendor: string;
  delivered: number;
  retrying: number;
  failed: number;
  lastFailureCode: number | null;
  failingSince: string | null;
};

export type VendorsReport = {
  asOf: string;
  keys: KeyRow[];
  webhooks: WebhookHealth[];
  disabledEndpoints: { vendor: string; name: string; disabledAt: string }[];
  redisError: string | null;
};

export async function getVendorsReport(redis: Redis): Promise<VendorsReport> {
  const now = new Date();
  // Redis first; after a Redis restart, the copy saved in Postgres.
  const { hashes, redisError } = await readBuckets(redis, [
    apiKeyDayKey(nepalDay(now)),
    apiKeyDayKey(nepalDay(new Date(now.getTime() - 86_400_000))),
    API_KEY_LAST_CALL_KEY,
  ]);
  const today = parseKeyDay(hashes[0]!);
  const yesterday = parseKeyDay(hashes[1]!);
  const lastCalls = hashes[2]!;

  // Keys active today, plus keys busy yesterday that have gone quiet.
  const keyIds = [...new Set([...today.keys(), ...yesterday.keys()])].filter(isUuid);
  const [details, webhooks, disabled] = await Promise.all([
    keyIds.length
      ? prisma.$queryRaw<{ id: string; key_prefix: string; vendor_id: string; revoked: boolean; vendor: string }[]>(
        buildKeyDetailsQuery(keyIds))
      : Promise.resolve([]),
    prisma.$queryRaw<{
      vendor_id: string; vendor: string; delivered: number; retrying: number; failed: number;
      last_failure_code: number | null; failing_since: Date | null;
    }[]>(buildWebhookHealthQuery()),
    prisma.$queryRaw<{ vendor: string; name: string; disabled_at: Date }[]>(buildDisabledEndpointsQuery()),
  ]);

  const keys: KeyRow[] = keyIds.map((keyId) => {
    const detail = details.find((d) => d.id === keyId);
    const calls = today.get(keyId) ?? { calls: 0, failed: 0, statuses: {} };
    const last = Number(lastCalls[keyId]);
    return {
      keyId,
      vendorId: detail?.vendor_id ?? null,
      vendor: detail?.vendor ?? "Deleted key",
      keyPrefix: detail?.key_prefix ?? keyId.slice(0, 8),
      revoked: detail?.revoked ?? false,
      lastCallAt: Number.isFinite(last) && last > 0 ? new Date(last).toISOString() : null,
      yesterdayCalls: yesterday.get(keyId)?.calls ?? 0,
      ...calls,
    };
  }).sort((a, b) => b.calls - a.calls || b.yesterdayCalls - a.yesterdayCalls);

  return {
    asOf: now.toISOString(),
    keys,
    webhooks: webhooks.map((w) => ({
      vendorId: w.vendor_id,
      vendor: w.vendor,
      delivered: w.delivered,
      retrying: w.retrying,
      failed: w.failed,
      lastFailureCode: w.last_failure_code,
      failingSince: w.failing_since?.toISOString() ?? null,
    })),
    disabledEndpoints: disabled.map((d) => ({ vendor: d.vendor, name: d.name, disabledAt: d.disabled_at.toISOString() })),
    redisError,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
