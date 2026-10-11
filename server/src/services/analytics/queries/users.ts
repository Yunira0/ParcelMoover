// Numbers behind `pm-stats users`. Read-only.
//
// "Active" = at least one logged-in request that Nepal day
// (user_daily_activity). "Online" = a request in the last 5 minutes.
// "Total" = accounts that are not deleted and not deactivated.

import { Prisma } from "../../../generated/prisma/client";
import prisma from "../../../lib/prisma";
import { USER_GROUPS, type UserGroup, userGroupSql } from "../groups";

const nepalToday = Prisma.sql`(now() AT TIME ZONE 'Asia/Kathmandu')::date`;

export function buildTotalsQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT user_group, COUNT(*)::int AS total
    FROM (
      SELECT u.id, ${userGroupSql} AS user_group
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.deleted_at IS NULL AND u.status = 'active'
      GROUP BY u.id
    ) grouped
    GROUP BY user_group`;
}

// One row per group plus an 'all' row. 'all' counts distinct people, so
// someone whose role changed inside the window is still counted once.
export function buildActiveQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(a.user_group, 'all') AS user_group,
           COUNT(DISTINCT a.user_id) FILTER (WHERE a.last_seen_at > now() - interval '5 minutes')::int AS online,
           COUNT(DISTINCT a.user_id) FILTER (WHERE a.day = t.today)::int AS today,
           COUNT(DISTINCT a.user_id) FILTER (WHERE a.day > t.today - 7)::int AS last_7_days,
           COUNT(DISTINCT a.user_id)::int AS last_30_days
    FROM user_daily_activity a, (SELECT ${nepalToday} AS today) t
    WHERE a.day > t.today - 30
    GROUP BY GROUPING SETS ((a.user_group), ())`;
}

export function buildTrendQuery(days: number): Prisma.Sql {
  return Prisma.sql`
    SELECT to_char(a.day, 'YYYY-MM-DD') AS day, a.user_group, COUNT(*)::int AS active
    FROM user_daily_activity a, (SELECT ${nepalToday} AS today) t
    WHERE a.day > t.today - ${days}::int
    GROUP BY a.day, a.user_group
    ORDER BY a.day, a.user_group`;
}

export function buildNewVendorsQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE (v.created_at AT TIME ZONE 'Asia/Kathmandu')::date = t.today)::int AS today,
           COUNT(*) FILTER (WHERE (v.created_at AT TIME ZONE 'Asia/Kathmandu')::date > t.today - 7)::int AS last_7_days,
           COUNT(*)::int AS last_30_days
    FROM vendors v, (SELECT ${nepalToday} AS today) t
    WHERE v.deleted_at IS NULL
      AND (v.created_at AT TIME ZONE 'Asia/Kathmandu')::date > t.today - 30`;
}

export function buildCalendarQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT to_char(${nepalToday}, 'YYYY-MM-DD') AS today,
           (SELECT to_char(min(day), 'YYYY-MM-DD') FROM user_daily_activity) AS tracking_since`;
}

export type GroupNumbers = {
  online: number;
  today: number;
  last7Days: number;
  last30Days: number;
  total: number;
};

export type UsersReport = {
  asOf: string;
  today: string;
  trackingSince: string | null;
  groups: Record<UserGroup | "all", GroupNumbers>;
  trend: { days: string[] } & Record<UserGroup, number[]>;
  newVendors: { today: number; last7Days: number; last30Days: number };
};

type ActiveRow = { user_group: string; online: number; today: number; last_7_days: number; last_30_days: number };

export async function getUsersReport(days = 30): Promise<UsersReport> {
  const [totals, active, trend, [newVendors], [calendar]] = await Promise.all([
    prisma.$queryRaw<{ user_group: UserGroup; total: number }[]>(buildTotalsQuery()),
    prisma.$queryRaw<ActiveRow[]>(buildActiveQuery()),
    prisma.$queryRaw<{ day: string; user_group: UserGroup; active: number }[]>(buildTrendQuery(days)),
    prisma.$queryRaw<{ today: number; last_7_days: number; last_30_days: number }[]>(buildNewVendorsQuery()),
    prisma.$queryRaw<{ today: string; tracking_since: string | null }[]>(buildCalendarQuery()),
  ]);

  const groups = {} as UsersReport["groups"];
  for (const group of [...USER_GROUPS, "all"] as const) {
    const row = active.find((r) => r.user_group === group);
    groups[group] = {
      online: row?.online ?? 0,
      today: row?.today ?? 0,
      last7Days: row?.last_7_days ?? 0,
      last30Days: row?.last_30_days ?? 0,
      total: group === "all"
        ? totals.reduce((sum, r) => sum + r.total, 0)
        : totals.find((r) => r.user_group === group)?.total ?? 0,
    };
  }

  const dayList = lastDays(calendar!.today, days);
  const series = Object.fromEntries(USER_GROUPS.map((group) => [
    group,
    dayList.map((day) => trend.find((r) => r.day === day && r.user_group === group)?.active ?? 0),
  ])) as Record<UserGroup, number[]>;

  return {
    asOf: new Date().toISOString(),
    today: calendar!.today,
    trackingSince: calendar!.tracking_since,
    groups,
    trend: { days: dayList, ...series },
    newVendors: {
      today: newVendors!.today,
      last7Days: newVendors!.last_7_days,
      last30Days: newVendors!.last_30_days,
    },
  };
}

// The `count` calendar days ending on `today` (YYYY-MM-DD), oldest first.
export function lastDays(today: string, count: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}
