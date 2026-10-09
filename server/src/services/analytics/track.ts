// Records that a person used the system today, for pm-stats.
//
// One row per person per Nepal calendar day (user_daily_activity). The first
// request of the day inserts it; later ones move last_seen_at forward, which
// is what "online now" reads, and keep the app platform/version current. Writes
// are throttled per person per process, so a busy session costs at most one
// small upsert a minute. Both release slots may write the same row; the upsert
// makes that harmless.
//
// Fire-and-forget: tracking must never slow down or fail a real request.

import prisma from "../../lib/prisma";
import type { AppClient } from "./client";
import { userGroupFor } from "./groups";

const WRITE_THROTTLE_MS = 60 * 1000;
const MAX_TRACKED_USERS = 10_000;
const lastWrites = new Map<string, number>();
const NO_CLIENT: AppClient = { platform: null, version: null };

export function recordUserActivity(userId: string, roles: readonly string[], client: AppClient = NO_CLIENT): void {
  const now = Date.now();
  const last = lastWrites.get(userId);
  if (last !== undefined && now - last < WRITE_THROTTLE_MS) return;
  if (lastWrites.size >= MAX_TRACKED_USERS) lastWrites.clear();
  lastWrites.set(userId, now);

  const group = userGroupFor(roles);
  Promise.resolve()
    .then(() => prisma.$executeRaw`
      INSERT INTO user_daily_activity (day, user_id, user_group, app_platform, app_version)
      VALUES ((now() AT TIME ZONE 'Asia/Kathmandu')::date, ${userId}::uuid, ${group}, ${client.platform}, ${client.version})
      ON CONFLICT (day, user_id) DO UPDATE
        SET last_seen_at = now(),
            user_group = EXCLUDED.user_group,
            app_platform = COALESCE(EXCLUDED.app_platform, user_daily_activity.app_platform),
            app_version = CASE WHEN EXCLUDED.app_platform IS NULL THEN user_daily_activity.app_version
                               ELSE EXCLUDED.app_version END`)
    .catch((error) => console.error("[Analytics] Failed to record user activity:", error));
}

// Tests only: forget throttle state between cases.
export function resetActivityThrottle(): void {
  lastWrites.clear();
}
