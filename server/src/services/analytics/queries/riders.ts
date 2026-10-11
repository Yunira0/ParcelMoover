// Numbers behind `pm-stats riders`: which app and version riders use. Read-only.
//
// Platform and version come from the rider app's request headers (see
// ../client.ts). "Newest" is the highest APK version seen in the last 30 days;
// the server cannot see GitHub Releases, so a version nobody has installed yet
// does not count.

import { Prisma } from "../../../generated/prisma/client";
import prisma from "../../../lib/prisma";

const nepalToday = Prisma.sql`(now() AT TIME ZONE 'Asia/Kathmandu')::date`;

export function buildAppsTodayQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT a.app_platform AS platform, a.app_version AS version, COUNT(*)::int AS riders
    FROM user_daily_activity a
    WHERE a.day = ${nepalToday} AND a.user_group = 'rider'
    GROUP BY a.app_platform, a.app_version`;
}

export function buildApkVersionsQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT a.app_version AS version, to_char(min(a.day), 'YYYY-MM-DD') AS first_day
    FROM user_daily_activity a
    WHERE a.user_group = 'rider' AND a.app_platform = 'android' AND a.app_version IS NOT NULL
      AND a.day > ${nepalToday} - 30
    GROUP BY a.app_version`;
}

// Share of Android riders on `version`, per day from its first day (at most 7).
export function buildUpdateProgressQuery(version: string, firstDay: string): Prisma.Sql {
  return Prisma.sql`
    SELECT to_char(a.day, 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE a.app_version = ${version})::int AS on_version,
           COUNT(*)::int AS android
    FROM user_daily_activity a
    WHERE a.user_group = 'rider' AND a.app_platform = 'android'
      AND a.day >= GREATEST(${firstDay}::date, ${nepalToday} - 6)
    GROUP BY a.day
    ORDER BY a.day`;
}

// Riders whose most recent APK in the last 30 days is not `newest` (or did not
// report a version at all). newest = null: every unversioned APK.
function outdatedRiders(newest: string | null): Prisma.Sql {
  return Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (a.user_id) a.user_id, a.app_platform, a.app_version, a.last_seen_at
      FROM user_daily_activity a
      WHERE a.user_group = 'rider' AND a.day > ${nepalToday} - 30
      ORDER BY a.user_id, a.day DESC
    )
    SELECT latest.*, r.name, COALESCE(l.name, 'No branch') AS branch
    FROM latest
    JOIN riders r ON r.user_id = latest.user_id AND r.deleted_at IS NULL
    LEFT JOIN locations l ON l.id = r.location_id
    WHERE latest.app_platform = 'android'
      AND ${newest === null ? Prisma.sql`latest.app_version IS NULL` : Prisma.sql`latest.app_version IS DISTINCT FROM ${newest}`}`;
}

export function buildOutdatedByBranchQuery(newest: string | null): Prisma.Sql {
  return Prisma.sql`
    SELECT o.branch, COUNT(*)::int AS riders
    FROM (${outdatedRiders(newest)}) o
    GROUP BY o.branch
    ORDER BY riders DESC, o.branch`;
}

export function buildOutdatedListQuery(newest: string | null): Prisma.Sql {
  return Prisma.sql`
    SELECT o.name, o.branch, o.app_version AS version, o.last_seen_at
    FROM (${outdatedRiders(newest)}) o
    ORDER BY o.branch, o.name`;
}

export function buildRiderTotalsQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::int AS riders,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM user_daily_activity a
             WHERE a.user_id = u.id AND a.last_seen_at > now() - interval '5 minutes'))::int AS online
    FROM riders r
    JOIN users u ON u.id = r.user_id
    WHERE r.carrier_code IS NULL AND r.deleted_at IS NULL AND r.status = 'active'
      AND u.deleted_at IS NULL AND u.status = 'active'`;
}

export type AppRow = { platform: string | null; version: string | null; riders: number };

export type RidersReport = {
  asOf: string;
  apps: AppRow[];
  activeToday: number;
  online: number;
  totalRiders: number;
  newest: { version: string; firstDay: string } | null;
  progress: { day: string; onVersion: number; android: number }[];
  outdatedByBranch: { branch: string; riders: number }[];
  outdated?: { name: string; branch: string; version: string | null; lastSeen: string }[];
};

export async function getRidersReport(options: { listOutdated: boolean }): Promise<RidersReport> {
  const [apps, versions, [totals]] = await Promise.all([
    prisma.$queryRaw<AppRow[]>(buildAppsTodayQuery()),
    prisma.$queryRaw<{ version: string; first_day: string }[]>(buildApkVersionsQuery()),
    prisma.$queryRaw<{ riders: number; online: number }[]>(buildRiderTotalsQuery()),
  ]);

  const newestRow = [...versions].sort((a, b) => compareVersions(b.version, a.version))[0];
  const newest = newestRow ? { version: newestRow.version, firstDay: newestRow.first_day } : null;

  const [progress, outdatedByBranch, outdated] = await Promise.all([
    newest
      ? prisma.$queryRaw<{ day: string; on_version: number; android: number }[]>(
        buildUpdateProgressQuery(newest.version, newest.firstDay))
      : Promise.resolve([]),
    prisma.$queryRaw<{ branch: string; riders: number }[]>(buildOutdatedByBranchQuery(newest?.version ?? null)),
    options.listOutdated
      ? prisma.$queryRaw<{ name: string; branch: string; version: string | null; last_seen_at: Date }[]>(
        buildOutdatedListQuery(newest?.version ?? null))
      : Promise.resolve(null),
  ]);

  return {
    asOf: new Date().toISOString(),
    apps: sortApps(apps, newest?.version ?? null),
    activeToday: apps.reduce((sum, row) => sum + row.riders, 0),
    online: totals!.online,
    totalRiders: totals!.riders,
    newest,
    progress: progress.map((p) => ({ day: p.day, onVersion: p.on_version, android: p.android })),
    outdatedByBranch,
    ...(outdated ? {
      outdated: outdated.map((o) => ({
        name: o.name, branch: o.branch, version: o.version, lastSeen: o.last_seen_at.toISOString(),
      })),
    } : {}),
  };
}

// Newest APK first, then older APKs, unversioned APKs, other platforms.
function sortApps(apps: AppRow[], newest: string | null): AppRow[] {
  const rank = (row: AppRow) =>
    row.platform === "android" ? (row.version === null ? 2 : row.version === newest ? 0 : 1)
      : row.platform === null ? 4 : 3;
  return [...apps].sort((a, b) =>
    rank(a) - rank(b) || compareVersions(b.version ?? "0.0.0", a.version ?? "0.0.0") || b.riders - a.riders);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
