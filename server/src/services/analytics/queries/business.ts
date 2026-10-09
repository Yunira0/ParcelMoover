// Numbers behind `pm-stats business`. Read-only.
//
// Uses the dashboard's own query builders (orders created, picked up,
// delivered, returned) so the terminal and the dashboard always agree. Each is
// run over three windows: today so far, the same time a week ago (a fair
// comparison for a day still in progress), and all of yesterday.
//
// COD collected = cash collected on parcels delivered in the window, the same
// figure as the dashboard's "Today's delivered" amount. Cancelled parcels
// never reach delivered, so they are never counted.

import { Prisma } from "../../../generated/prisma/client";
import prisma from "../../../lib/prisma";
import { NEPAL_UTC_OFFSET_MS, formatNepalDate } from "../../../utils/nepalTime";
import { buildReturnedTrendQuery } from "../../orders/dashboard-returns";
import { buildDashboardTrendQuery, type TrendDayRange } from "../../orders/dashboard-trend";
import { IN_DELIVERY_STATUSES } from "../../orders/status-shared";

const DAY_MS = 86_400_000;

// Oldest first, as the dashboard builders expect.
export function businessWindows(now: Date): { lastWeek: TrendDayRange; yesterday: TrendDayRange; today: TrendDayRange } {
  const todayStart = new Date(Date.parse(`${formatNepalDate(now)}T00:00:00Z`) - NEPAL_UTC_OFFSET_MS);
  return {
    lastWeek: { start: new Date(todayStart.getTime() - 7 * DAY_MS), end: new Date(now.getTime() - 7 * DAY_MS) },
    yesterday: { start: new Date(todayStart.getTime() - DAY_MS), end: todayStart },
    today: { start: todayStart, end: now },
  };
}

// Scopes take the parcel alias `p.`; the dashboard's trend builder uses none.
export function originScope(locationIds: string[] | null, alias = ""): Prisma.Sql {
  return locationIds ? Prisma.sql`AND ${Prisma.raw(`${alias}origin_location_id`)} = ANY(${locationIds}::uuid[])` : Prisma.empty;
}

export function buildBranchLookupQuery(name: string): Prisma.Sql {
  return Prisma.sql`SELECT id, name FROM locations WHERE name ILIKE ${`%${name}%`} ORDER BY name`;
}

export function buildCancelledQuery(ranges: TrendDayRange[], scope: Prisma.Sql = Prisma.empty): Prisma.Sql {
  const columns = ranges.map(({ start, end }, i) => Prisma.sql`
    COUNT(DISTINCT h.parcel_id) FILTER (WHERE h.created_at >= ${start} AND h.created_at < ${end}) AS ${Prisma.raw(`d${i}_cancelled`)}`);
  return Prisma.sql`
    SELECT ${Prisma.join(columns, ",")}
    FROM parcel_status_history h JOIN parcels p ON p.id = h.parcel_id
    WHERE h.new_status = 'cancelled'::parcel_status
      AND h.created_at >= ${ranges[0]!.start} AND h.created_at < ${ranges[ranges.length - 1]!.end}
      AND p.deleted_at IS NULL ${scope}`;
}

export function buildCodCollectedQuery(ranges: TrendDayRange[], scope: Prisma.Sql = Prisma.empty): Prisma.Sql {
  const columns = ranges.map(({ start, end }, i) => Prisma.sql`
    COALESCE(SUM(COALESCE(cc.collected_amount, p.cod_amount)) FILTER (WHERE p.delivered_at >= ${start} AND p.delivered_at < ${end}), 0)::text
      AS ${Prisma.raw(`d${i}_cod`)}`);
  return Prisma.sql`
    SELECT ${Prisma.join(columns, ",")}
    FROM parcels p LEFT JOIN cod_collections cc ON cc.parcel_id = p.id
    WHERE p.deleted_at IS NULL
      AND p.status::text = ANY(ARRAY['delivered','partially_delivered'])
      AND p.delivered_at >= ${ranges[0]!.start} AND p.delivered_at < ${ranges[ranges.length - 1]!.end} ${scope}`;
}

// Right now: with a rider for delivery, and anywhere between pickup and
// delivery (the dashboard's "in delivery" bucket).
export function buildInProgressQuery(scope: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE status::text = 'sent_for_delivery')::int AS out_for_delivery,
           COUNT(*)::int AS in_progress
    FROM parcels
    WHERE deleted_at IS NULL AND status::text = ANY(${IN_DELIVERY_STATUSES}) ${scope}`;
}

// Today by the branch an order started from.
export function buildBranchTodayQuery(today: TrendDayRange, scope: Prisma.Sql = Prisma.empty): Prisma.Sql {
  const { start, end } = today;
  return Prisma.sql`
    SELECT COALESCE(l.name, 'No branch') AS branch,
           COUNT(*) FILTER (WHERE p.created_at >= ${start} AND p.created_at < ${end})::int AS orders,
           COUNT(*) FILTER (WHERE p.status::text = ANY(ARRAY['delivered','partially_delivered'])
                              AND p.delivered_at >= ${start} AND p.delivered_at < ${end})::int AS delivered,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM parcel_status_history h
             WHERE h.parcel_id = p.id AND h.new_status = 'returned_to_vendor'::parcel_status
               AND h.created_at >= ${start} AND h.created_at < ${end}))::int AS returned,
           COALESCE(SUM(COALESCE(cc.collected_amount, p.cod_amount)) FILTER (
             WHERE p.status::text = ANY(ARRAY['delivered','partially_delivered'])
               AND p.delivered_at >= ${start} AND p.delivered_at < ${end}), 0)::text AS cod
    FROM parcels p
    LEFT JOIN locations l ON l.id = p.origin_location_id
    LEFT JOIN cod_collections cc ON cc.parcel_id = p.id
    WHERE p.deleted_at IS NULL
      AND (p.created_at >= ${start} OR p.delivered_at >= ${start} OR p.updated_at >= ${start}) ${scope}
    GROUP BY l.name
    ORDER BY orders DESC, branch`;
}

export type Measure = { today: number; lastWeek: number; yesterday: number };

export type BusinessReport = {
  asOf: string;
  created: Measure;
  pickedUp: Measure;
  delivered: Measure;
  returned: Measure;
  cancelled: Measure;
  codCollected: Measure;
  outForDelivery: number;
  inProgress: number;
  // Branch names matched by --branch; null = every branch.
  branchFilter: string[] | null;
  branches: { branch: string; orders: number; delivered: number; returned: number; cod: number }[];
};

export class UnknownBranchError extends Error {}

export async function getBusinessReport(branch: string | null = null): Promise<BusinessReport> {
  const now = new Date();
  const w = businessWindows(now);
  const ranges = [w.lastWeek, w.yesterday, w.today];

  let locations: { id: string; name: string }[] | null = null;
  if (branch) {
    locations = await prisma.$queryRaw<{ id: string; name: string }[]>(buildBranchLookupQuery(branch));
    if (locations.length === 0) throw new UnknownBranchError(`No branch name contains "${branch}".`);
  }
  const ids = locations?.map((l) => l.id) ?? null;

  const [[trend], [returned], [cancelled], [cod], [current], branches] = await Promise.all([
    prisma.$queryRaw<Record<string, bigint>[]>(buildDashboardTrendQuery(ranges, originScope(ids))),
    prisma.$queryRaw<Record<string, bigint>[]>(buildReturnedTrendQuery(ranges, originScope(ids, "p."))),
    prisma.$queryRaw<Record<string, bigint>[]>(buildCancelledQuery(ranges, originScope(ids, "p."))),
    prisma.$queryRaw<Record<string, string>[]>(buildCodCollectedQuery(ranges, originScope(ids, "p."))),
    prisma.$queryRaw<{ out_for_delivery: number; in_progress: number }[]>(buildInProgressQuery(originScope(ids))),
    prisma.$queryRaw<{ branch: string; orders: number; delivered: number; returned: number; cod: string }[]>(
      buildBranchTodayQuery(w.today, originScope(ids, "p."))),
  ]);

  // ranges order: 0 = last week, 1 = yesterday, 2 = today.
  const measure = (row: Record<string, bigint | string> | undefined, column: string): Measure => ({
    lastWeek: Number(row?.[`d0_${column}`] ?? 0),
    yesterday: Number(row?.[`d1_${column}`] ?? 0),
    today: Number(row?.[`d2_${column}`] ?? 0),
  });

  return {
    asOf: now.toISOString(),
    created: measure(trend, "total"),
    pickedUp: measure(trend, "picked_up"),
    delivered: measure(trend, "delivered"),
    returned: measure(returned, "returned"),
    cancelled: measure(cancelled, "cancelled"),
    codCollected: measure(cod, "cod"),
    outForDelivery: current?.out_for_delivery ?? 0,
    inProgress: current?.in_progress ?? 0,
    branchFilter: locations?.map((l) => l.name) ?? null,
    branches: branches
      .filter((b) => b.orders + b.delivered + b.returned > 0)
      .map((b) => ({ ...b, cod: Number(b.cod) })),
  };
}
