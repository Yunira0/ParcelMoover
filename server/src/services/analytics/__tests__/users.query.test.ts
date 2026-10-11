import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import { userGroupFor } from "../groups";
import {
  buildActiveQuery, buildCalendarQuery, buildNewVendorsQuery, buildTotalsQuery, buildTrendQuery, lastDays,
} from "../queries/users";

const db = new PGlite();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const today = "(now() AT TIME ZONE 'Asia/Kathmandu')::date";

const people: { n: number; roles: string[]; deleted?: boolean; status?: string }[] = [
  { n: 1, roles: ["super_admin"] },
  { n: 2, roles: ["admin"], deleted: true },
  { n: 3, roles: ["accountant"], status: "inactive" },
  { n: 4, roles: ["rider"] },
  { n: 5, roles: ["admin", "rider"] },
  { n: 6, roles: ["vendor"] },
  { n: 7, roles: ["vendor_staff"] },
  { n: 8, roles: [] },
];

async function run<T>(query: Prisma.Sql): Promise<T[]> {
  return (await db.query<T>(query.text, query.values)).rows;
}

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE roles (id uuid PRIMARY KEY, code text);
    CREATE TABLE users (id uuid PRIMARY KEY, deleted_at timestamptz, status text DEFAULT 'active');
    CREATE TABLE user_roles (user_id uuid, role_id uuid);
    CREATE TABLE vendors (id uuid PRIMARY KEY, created_at timestamptz, deleted_at timestamptz);
    CREATE TABLE user_daily_activity (
      day date, user_id uuid, user_group text,
      first_seen_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(),
      PRIMARY KEY (day, user_id)
    );
  `);
  const codes = [...new Set(people.flatMap((p) => p.roles))];
  for (const [i, code] of codes.entries()) {
    await db.query("INSERT INTO roles VALUES ($1, $2)", [id(100 + i), code]);
  }
  for (const p of people) {
    await db.query("INSERT INTO users VALUES ($1, $2, $3)", [id(p.n), p.deleted ? new Date() : null, p.status ?? "active"]);
    for (const code of p.roles) {
      await db.query("INSERT INTO user_roles VALUES ($1, $2)", [id(p.n), id(100 + codes.indexOf(code))]);
    }
  }

  const activity: [person: number, daysAgo: number, lastSeen: string][] = [
    [4, 0, "now()"], [4, 1, "now() - interval '1 day'"], [4, 10, "now() - interval '10 days'"],
    [5, 3, "now() - interval '3 days'"],
    [6, 20, "now() - interval '20 days'"],
    [1, 0, "now() - interval '10 minutes'"], [1, 40, "now() - interval '40 days'"],
    [7, 29, "now() - interval '29 days'"],
  ];
  for (const [person, daysAgo, lastSeen] of activity) {
    const group = userGroupFor(people.find((p) => p.n === person)!.roles);
    await db.query(
      `INSERT INTO user_daily_activity (day, user_id, user_group, last_seen_at)
       VALUES (${today} - $1::int, $2, $3, ${lastSeen})`,
      [daysAgo, id(person), group],
    );
  }

  for (const [n, created, deleted] of [
    [1, "now()", null], [2, "now() - interval '3 days'", null], [3, "now() - interval '20 days'", null],
    [4, "now() - interval '40 days'", null], [5, "now()", "now()"],
  ] as const) {
    await db.exec(`INSERT INTO vendors VALUES ('${id(200 + n)}', ${created}, ${deleted ?? "NULL"})`);
  }
}, 20_000);

afterAll(() => db.close());

describe("pm-stats users queries", () => {
  it("groups people the same way in SQL as in the tracker", async () => {
    const rows = await run<{ user_group: string; total: number }>(buildTotalsQuery());
    const totals = Object.fromEntries(rows.map((r) => [r.user_group, r.total]));
    // Deleted (#2) and deactivated (#3) accounts are not counted.
    expect(totals).toEqual({ staff: 2, rider: 2, vendor: 2 });

    const expected = { staff: 0, rider: 0, vendor: 0 };
    for (const p of people.filter((p) => !p.deleted && p.status !== "inactive")) expected[userGroupFor(p.roles)]++;
    expect(totals).toEqual(expected);
  });

  it("counts online, today, 7 and 30 days per group, and each person once overall", async () => {
    const rows = await run<Record<string, string | number>>(buildActiveQuery());
    const byGroup = Object.fromEntries(rows.map(({ user_group, ...numbers }) => [user_group, numbers]));
    expect(byGroup).toEqual({
      rider: { online: 1, today: 1, last_7_days: 2, last_30_days: 2 },
      vendor: { online: 0, today: 0, last_7_days: 0, last_30_days: 2 },
      staff: { online: 0, today: 1, last_7_days: 1, last_30_days: 1 },
      all: { online: 1, today: 2, last_7_days: 3, last_30_days: 5 },
    });
  });

  it("returns the daily trend inside the window only", async () => {
    const [calendar] = await run<{ today: string }>(buildCalendarQuery());
    const day = calendar!.today;
    const [, yesterday, , threeDaysAgo] = lastDays(day, 4).reverse();
    const rows = await run<{ day: string; user_group: string; active: number }>(buildTrendQuery(7));
    expect(rows).toEqual([
      { day: threeDaysAgo, user_group: "rider", active: 1 },
      { day: yesterday, user_group: "rider", active: 1 },
      { day, user_group: "rider", active: 1 },
      { day, user_group: "staff", active: 1 },
    ]);
  });

  it("counts new vendors and skips deleted ones", async () => {
    const [row] = await run(buildNewVendorsQuery());
    expect(row).toEqual({ today: 1, last_7_days: 2, last_30_days: 3 });
  });

  it("reports when tracking started", async () => {
    const [row] = await run<{ today: string; tracking_since: string }>(buildCalendarQuery());
    expect(row!.tracking_since).toBe(lastDays(row!.today, 41)[0]);
  });
});

describe("lastDays", () => {
  it("lists calendar days oldest first, across month ends", () => {
    expect(lastDays("2026-10-01", 3)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  });
});
