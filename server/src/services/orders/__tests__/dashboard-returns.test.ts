import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { buildReturnedTodayQuery, buildReturnedTrendQuery } from "../dashboard-returns";

const db = new PGlite();
const vendorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const vendorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const start = new Date("2026-10-04T00:00:00+05:45");
const day = 86_400_000;
const ranges = Array.from({ length: 2 }, (_, i) => ({ start: new Date(+start + i * day), end: new Date(+start + (i + 1) * day) }));

beforeAll(async () => {
  await db.exec(`
    CREATE TYPE parcel_status AS ENUM ('picked_up','returned_to_vendor');
    CREATE TABLE parcels (id integer PRIMARY KEY, vendor_id uuid, deleted_at timestamptz, origin_location_id text, delivery_rider_id text);
    CREATE TABLE parcel_status_history (parcel_id integer, new_status parcel_status, created_at timestamptz);
    INSERT INTO parcels VALUES
      (1,'${vendorA}',NULL,'one','r1'), (2,'${vendorA}',NULL,'two','r2'),
      (3,'${vendorB}',NULL,'two','r2'), (4,'${vendorA}',now(),'one','r1');
  `);
  for (const [parcelId, offset, status] of [
    [1, -1, "returned_to_vendor"], [1, 0, "returned_to_vendor"], [1, 1, "returned_to_vendor"],
    [1, day, "returned_to_vendor"], [2, 0, "picked_up"], [2, day - 1, "returned_to_vendor"],
    [3, 0, "returned_to_vendor"], [4, 0, "returned_to_vendor"], [2, 2 * day, "returned_to_vendor"],
  ] as const) {
    await db.query("INSERT INTO parcel_status_history VALUES ($1,$2::parcel_status,$3)", [parcelId, status, new Date(+start + offset)]);
  }
  await db.exec("CREATE INDEX history_lookup ON parcel_status_history(new_status,created_at,parcel_id)");
}, 20_000);
afterAll(() => db.close());

describe("indexed return-history queries", () => {
  for (const [name, scope, expected] of [
    ["admin", Prisma.empty, [3, 1]],
    ["vendor", Prisma.sql`AND p.vendor_id = ${vendorA}::uuid`, [2, 1]],
    ["sales vendor set", Prisma.sql`AND p.vendor_id = ANY(${[vendorA]}::uuid[])`, [2, 1]],
    ["branch", Prisma.sql`AND p.origin_location_id = ${"one"}`, [1, 1]],
    ["rider", Prisma.sql`AND p.delivery_rider_id = ${"r1"}`, [1, 1]],
  ] as const) {
    it(`preserves distinct parcels, soft deletes and Nepal day boundaries for ${name}`, async () => {
      const query = buildReturnedTrendQuery(ranges, scope);
      const result = await db.query<Record<string, number>>(query.text, query.values);
      expect(Object.values(result.rows[0]!).map(Number)).toEqual(expected);
      // Execute the old predicate against the same fixture, not a mock.
      const old = query.text.replace("h.new_status = 'returned_to_vendor'::parcel_status", "h.new_status::text = 'returned_to_vendor'");
      expect((await db.query(old, query.values)).rows).toEqual(result.rows);
      const today = buildReturnedTodayQuery(ranges[1]!.start, scope);
      const before = today.text.replace("h.new_status = 'returned_to_vendor'::parcel_status", "h.new_status::text = 'returned_to_vendor'");
      expect((await db.query(today.text, today.values)).rows).toEqual((await db.query(before, today.values)).rows);
    });
  }
  it("parameterizes actor values", async () => {
    const query = buildReturnedTrendQuery(ranges, Prisma.sql`AND p.origin_location_id = ${"one' OR true --"}`);
    expect(Object.values((await db.query(query.text, query.values)).rows[0]!).map(Number)).toEqual([0, 0]);
  });
});
