import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import {
  buildApkVersionsQuery, buildAppsTodayQuery, buildOutdatedByBranchQuery, buildOutdatedListQuery,
  buildRiderTotalsQuery, buildUpdateProgressQuery, compareVersions,
} from "../queries/riders";

const db = new PGlite();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const today = "(now() AT TIME ZONE 'Asia/Kathmandu')::date";

async function run<T>(query: Prisma.Sql): Promise<T[]> {
  return (await db.query<T>(query.text, query.values)).rows;
}

async function day(offset: number): Promise<string> {
  const { rows } = await db.query<{ d: string }>(`SELECT to_char(${today} - $1::int, 'YYYY-MM-DD') AS d`, [offset]);
  return rows[0]!.d;
}

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE users (id uuid PRIMARY KEY, deleted_at timestamptz, status text DEFAULT 'active');
    CREATE TABLE locations (id uuid PRIMARY KEY, name text);
    CREATE TABLE riders (
      id uuid PRIMARY KEY, user_id uuid, name text, location_id uuid,
      status text DEFAULT 'active', carrier_code text, deleted_at timestamptz
    );
    CREATE TABLE user_daily_activity (
      day date, user_id uuid, user_group text,
      first_seen_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(),
      app_platform text, app_version text, PRIMARY KEY (day, user_id)
    );
    INSERT INTO locations VALUES ('${id(901)}', 'Kathmandu'), ('${id(902)}', 'Pokhara');
  `);
  const riders: [n: number, name: string, location: number | null, carrier: string | null][] = [
    [1, "Asha", 901, null], [2, "Bikash", 901, null], [3, "Chandra", 902, null],
    [4, "Dipa", null, null], [5, "Eshan", 902, null], [6, "Furba", 901, null], [7, "NCM", null, "ncm"],
  ];
  for (const [n, name, location, carrier] of riders) {
    await db.query("INSERT INTO users (id) VALUES ($1)", [id(n)]);
    await db.query("INSERT INTO riders (id, user_id, name, location_id, carrier_code) VALUES ($1, $2, $3, $4, $5)",
      [id(100 + n), id(n), name, location ? id(location) : null, carrier]);
  }
  await db.query("INSERT INTO users (id) VALUES ($1)", [id(50)]);

  const activity: [n: number, daysAgo: number, group: string, platform: string | null, version: string | null, lastSeen: string][] = [
    [1, 0, "rider", "android", "1.4.3", "now()"],
    [2, 0, "rider", "android", "1.4.2", "now() - interval '1 hour'"],
    [2, 1, "rider", "android", "1.4.2", "now() - interval '1 day'"],
    [3, 0, "rider", "android", null, "now() - interval '2 hours'"],
    [4, 0, "rider", "web", "1.4.3", "now() - interval '3 hours'"],
    [5, 2, "rider", "android", "1.4.3", "now() - interval '2 days'"],
    [6, 40, "rider", "android", "1.5.0", "now() - interval '40 days'"],
    [50, 0, "staff", null, null, "now()"],
  ];
  for (const [n, daysAgo, group, platform, version, lastSeen] of activity) {
    await db.query(
      `INSERT INTO user_daily_activity (day, user_id, user_group, app_platform, app_version, last_seen_at)
       VALUES (${today} - $1::int, $2, $3, $4, $5, ${lastSeen})`,
      [daysAgo, id(n), group, platform, version],
    );
  }
}, 20_000);

afterAll(() => db.close());

describe("pm-stats riders queries", () => {
  it("counts today's riders per app and version, staff excluded", async () => {
    const rows = await run<{ platform: string | null; version: string | null; riders: number }>(buildAppsTodayQuery());
    expect(rows.sort((a, b) => `${a.platform}${a.version}`.localeCompare(`${b.platform}${b.version}`))).toEqual([
      { platform: "android", version: "1.4.2", riders: 1 },
      { platform: "android", version: "1.4.3", riders: 1 },
      { platform: "android", version: null, riders: 1 },
      { platform: "web", version: "1.4.3", riders: 1 },
    ]);
  });

  it("finds APK versions seen in the last 30 days with their first day", async () => {
    const rows = await run<{ version: string; first_day: string }>(buildApkVersionsQuery());
    expect(rows.sort((a, b) => a.version.localeCompare(b.version))).toEqual([
      { version: "1.4.2", first_day: await day(1) },
      { version: "1.4.3", first_day: await day(2) },
    ]);
  });

  it("tracks the share of Android riders on a version per day", async () => {
    const rows = await run(buildUpdateProgressQuery("1.4.3", await day(2)));
    expect(rows).toEqual([
      { day: await day(2), on_version: 1, android: 1 },
      { day: await day(1), on_version: 0, android: 1 },
      { day: await day(0), on_version: 1, android: 3 },
    ]);
  });

  it("lists riders whose last APK is older or unversioned, by branch", async () => {
    expect(await run(buildOutdatedByBranchQuery("1.4.3"))).toEqual([
      { branch: "Kathmandu", riders: 1 },
      { branch: "Pokhara", riders: 1 },
    ]);
    const list = await run<{ name: string; version: string | null }>(buildOutdatedListQuery("1.4.3"));
    expect(list.map((r) => [r.name, r.version])).toEqual([["Bikash", "1.4.2"], ["Chandra", null]]);
    // No versioned APK seen yet: only APKs that sent no version are outdated.
    expect((await run<{ name: string }>(buildOutdatedListQuery(null))).map((r) => r.name)).toEqual(["Chandra"]);
  });

  it("counts real rider accounts, not carrier placeholders", async () => {
    expect(await run(buildRiderTotalsQuery())).toEqual([{ riders: 6, online: 1 }]);
  });
});

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.4.2", "1.4.3")).toBeLessThan(0);
    expect(compareVersions("1.4.3", "1.4.3")).toBe(0);
  });
});
