import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { buildDashboardTrendQuery } from "../dashboard-trend";

const db = new PGlite();
const day = 86_400_000;
const start = Date.parse("2026-10-04T00:00:00+05:45");
const old = start - 400 * day;
const at = (days: number) => new Date(start + days * day);
const rows = [
  { id: 1, vendor: "a", status: "delivered", created: old, pickup: start, delivered: start + day, deleted: null, origin: "one", current: "two", pickupRider: "r1", deliveryRider: "r2" },
  { id: 2, vendor: "a", status: "partially_delivered", created: old, pickup: old, delivered: start, deleted: null, origin: "two", current: "one", pickupRider: "r2", deliveryRider: "r1" },
  { id: 3, vendor: "b", status: "picked_up", created: start, pickup: start, delivered: null, deleted: null, origin: "two", current: "two", pickupRider: "r1", deliveryRider: null },
  { id: 4, vendor: "a", status: "delivered", created: start, pickup: start, delivered: start, deleted: start, origin: "one", current: "one", pickupRider: "r1", deliveryRider: "r1" },
  { id: 5, vendor: "a", status: "cancelled", created: start + day, pickup: null, delivered: start + day, deleted: null, origin: "one", current: "one", pickupRider: null, deliveryRider: null },
  { id: 6, vendor: "a", status: "delivered", created: start + 7 * day, pickup: start + 7 * day, delivered: start + 7 * day, deleted: null, origin: "two", current: "two", pickupRider: null, deliveryRider: "r1" },
  { id: 7, vendor: "a", status: "picked_up", created: old, pickup: start + 6 * day, delivered: null, deleted: null, origin: "one", current: "two", pickupRider: "r1", deliveryRider: null },
  { id: 8, vendor: "a", status: "delivered", created: start - 1, pickup: start - 1, delivered: start - 1, deleted: null, origin: "one", current: "one", pickupRider: "r1", deliveryRider: "r1" },
  { id: 9, vendor: "b", status: "ready_to_deliver", created: old, pickup: start, delivered: null, deleted: null, origin: "two", current: "two", pickupRider: "r1", deliveryRider: "r2" },
  { id: 10, vendor: "b", status: "delivered", created: start + 29 * day, pickup: start + 29 * day, delivered: start + 30 * day, deleted: null, origin: "two", current: "one", pickupRider: "r2", deliveryRider: "r1" },
];

beforeAll(async () => {
  await db.exec(`CREATE TABLE parcels (
    id integer PRIMARY KEY, vendor_id text, status text, created_at timestamptz,
    picked_up_at timestamptz, delivered_at timestamptz, deleted_at timestamptz,
    origin_location_id text, current_location_id text, pickup_rider_id text, delivery_rider_id text
  )`);
  for (const row of rows) {
    const date = (value: number | null) => value === null ? null : new Date(value);
    await db.query("INSERT INTO parcels VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [
      row.id, row.vendor, row.status, date(row.created), date(row.pickup), date(row.delivered), date(row.deleted),
      row.origin, row.current, row.pickupRider, row.deliveryRider,
    ]);
  }
}, 20_000);
afterAll(() => db.close());

const scopes = [
  { name: "admin", sql: Prisma.empty, includes: () => true },
  { name: "vendor", sql: Prisma.sql`AND vendor_id = ${"a"}`, includes: (row: typeof rows[number]) => row.vendor === "a" },
  { name: "sales vendor set", sql: Prisma.sql`AND vendor_id = ANY(${["a"]}::text[])`, includes: (row: typeof rows[number]) => row.vendor === "a" },
  { name: "branch", sql: Prisma.sql`AND (origin_location_id = ${"one"} OR current_location_id = ${"one"})`, includes: (row: typeof rows[number]) => row.origin === "one" || row.current === "one" },
  { name: "rider", sql: Prisma.sql`AND (delivery_rider_id = ${"r1"} OR (pickup_rider_id = ${"r1"} AND status <> ALL(${["ready_to_deliver", "sent_for_delivery", "failed_delivery"]}::text[])))`, includes: (row: typeof rows[number]) => row.deliveryRider === "r1" || (row.pickupRider === "r1" && !["ready_to_deliver", "sent_for_delivery", "failed_delivery"].includes(row.status)) },
];

describe.each([7, 30])("%i-day trend", (days) => {
  for (const scope of scopes) {
    it(`preserves milestone counts and ${scope.name} ownership at Nepal day boundaries`, async () => {
      const ranges = Array.from({ length: days }, (_, i) => ({ start: at(i), end: at(i + 1) }));
      const query = buildDashboardTrendQuery(ranges, scope.sql);
      const result = await db.query<Record<string, string>>(query.text, query.values);
      const actual = Object.fromEntries(Object.entries(result.rows[0]!).map(([key, value]) => [key, Number(value)]));
      const expected: Record<string, number> = {};
      for (let i = 0; i < days; i++) {
        const eligible = rows.filter((row) => row.deleted === null && scope.includes(row));
        const inDay = (value: number | null) => value !== null && value >= start + i * day && value < start + (i + 1) * day;
        expected[`d${i}_total`] = eligible.filter((row) => inDay(row.created)).length;
        expected[`d${i}_picked_up`] = eligible.filter((row) => inDay(row.pickup)).length;
        expected[`d${i}_delivered`] = eligible.filter((row) => ["delivered", "partially_delivered"].includes(row.status) && inDay(row.delivered)).length;
      }
      expect(actual).toEqual(expected);
    });
  }
});

it("parameterizes vendor scope so a malformed ID cannot include another vendor", async () => {
  const query = buildDashboardTrendQuery([{ start: at(0), end: at(1) }], Prisma.sql`AND vendor_id = ${"a' OR true --"}`);
  const result = await db.query<Record<string, string>>(query.text, query.values);
  expect(Object.values(result.rows[0]!).map(Number)).toEqual([0, 0, 0]);
});
