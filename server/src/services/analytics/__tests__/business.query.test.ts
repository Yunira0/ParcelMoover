import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { buildReturnedTrendQuery } from "../../orders/dashboard-returns";
import { buildDashboardTrendQuery } from "../../orders/dashboard-trend";
import {
  buildBranchLookupQuery, buildBranchTodayQuery, buildCancelledQuery, buildCodCollectedQuery, buildInProgressQuery,
  businessWindows, originScope,
} from "../queries/business";

const db = new PGlite();
// 14:32 in Nepal on Friday 9 Oct 2026.
const now = new Date("2026-10-09T08:47:00Z");
const w = businessWindows(now);
const ranges = [w.lastWeek, w.yesterday, w.today];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KTM = id(901);
const PKR = id(902);

async function first(query: Prisma.Sql): Promise<Record<string, unknown>> {
  return (await db.query<Record<string, unknown>>(query.text, query.values)).rows[0]!;
}

beforeAll(async () => {
  await db.exec(`
    CREATE TYPE parcel_status AS ENUM ('pickup_ordered','picked_up','sent_for_delivery','delivered','partially_delivered','cancelled','returned_to_vendor');
    CREATE TABLE locations (id uuid PRIMARY KEY, name text);
    CREATE TABLE parcels (
      id uuid PRIMARY KEY, status parcel_status, origin_location_id uuid, cod_amount numeric(12,2) DEFAULT 0,
      created_at timestamptz, picked_up_at timestamptz, delivered_at timestamptz, updated_at timestamptz, deleted_at timestamptz
    );
    CREATE TABLE parcel_status_history (parcel_id uuid, new_status parcel_status, created_at timestamptz);
    CREATE TABLE cod_collections (parcel_id uuid UNIQUE, collected_amount numeric(12,2));
    INSERT INTO locations VALUES ('${KTM}', 'Kathmandu'), ('${PKR}', 'Pokhara');
  `);
  const parcels: [n: number, status: string, origin: string, cod: number, created: string, delivered: string | null, deleted?: boolean][] = [
    [1, "delivered", KTM, 1000, "2026-10-09T04:15:00Z", "2026-10-09T06:15:00Z"],
    [2, "sent_for_delivery", PKR, 400, "2026-10-09T05:00:00Z", null],
    [3, "delivered", KTM, 500, "2026-10-02T03:15:00Z", "2026-10-02T05:00:00Z"],
    [4, "returned_to_vendor", KTM, 300, "2026-10-08T09:15:00Z", null],
    [5, "cancelled", KTM, 700, "2026-10-09T03:00:00Z", null],
    // Last week, but after 14:32: outside "same time last week".
    [6, "pickup_ordered", PKR, 0, "2026-10-02T10:00:00Z", null],
    [7, "pickup_ordered", KTM, 0, "2026-10-09T04:00:00Z", null, true],
  ];
  for (const [n, status, origin, cod, created, delivered, deleted] of parcels) {
    await db.query(
      `INSERT INTO parcels VALUES ($1, $2::parcel_status, $3, $4, $5, NULL, $6, $7, $8)`,
      [id(n), status, origin, cod, created, delivered, delivered ?? created, deleted ? created : null],
    );
  }
  await db.exec(`
    INSERT INTO cod_collections VALUES ('${id(1)}', 900);
    INSERT INTO parcel_status_history VALUES
      ('${id(4)}', 'returned_to_vendor', '2026-10-09T05:15:00Z'),
      ('${id(5)}', 'cancelled', '2026-10-09T03:30:00Z');
    UPDATE parcels SET updated_at = '2026-10-09T05:15:00Z' WHERE id = '${id(4)}';
  `);
}, 20_000);

afterAll(() => db.close());

describe("pm-stats business windows", () => {
  it("compares today so far with the same time last week and all of yesterday", () => {
    expect(w.today).toEqual({ start: new Date("2026-10-08T18:15:00Z"), end: now });
    expect(w.lastWeek).toEqual({ start: new Date("2026-10-01T18:15:00Z"), end: new Date("2026-10-02T08:47:00Z") });
    expect(w.yesterday).toEqual({ start: new Date("2026-10-07T18:15:00Z"), end: new Date("2026-10-08T18:15:00Z") });
  });
});

describe("pm-stats business queries", () => {
  it("reuses the dashboard's created / delivered counts across the three windows", async () => {
    const row = await first(buildDashboardTrendQuery(ranges, Prisma.empty));
    // d0 = last week, d1 = yesterday, d2 = today.
    expect([row.d0_total, row.d1_total, row.d2_total].map(Number)).toEqual([1, 1, 3]);
    expect([row.d0_delivered, row.d1_delivered, row.d2_delivered].map(Number)).toEqual([1, 0, 1]);
  });

  it("counts returns and cancellations by when they happened", async () => {
    const returned = await first(buildReturnedTrendQuery(ranges, Prisma.empty));
    expect(Number(returned.d2_returned)).toBe(1);
    const cancelled = await first(buildCancelledQuery(ranges));
    expect([cancelled.d0_cancelled, cancelled.d2_cancelled].map(Number)).toEqual([0, 1]);
  });

  it("counts cash collected on delivered parcels only", async () => {
    const cod = await first(buildCodCollectedQuery(ranges));
    // Today: 900 collected (not the 1,000 declared). Cancelled #5 never counts.
    expect([cod.d0_cod, cod.d1_cod, cod.d2_cod].map(Number)).toEqual([500, 0, 900]);
  });

  it("shows what is out for delivery right now", async () => {
    expect(await first(buildInProgressQuery())).toEqual({ out_for_delivery: 1, in_progress: 1 });
  });

  it("narrows every number to one branch with --branch", async () => {
    const lookup = buildBranchLookupQuery("khar");
    const found = (await db.query<{ id: string; name: string }>(lookup.text, lookup.values)).rows;
    expect(found.map((l) => l.name)).toEqual(["Pokhara"]);
    const ids = found.map((l) => l.id);

    const trend = await first(buildDashboardTrendQuery(ranges, originScope(ids)));
    expect(Number(trend.d2_total)).toBe(1);
    const cod = await first(buildCodCollectedQuery(ranges, originScope(ids, "p.")));
    expect(Number(cod.d2_cod)).toBe(0);
    expect(await first(buildInProgressQuery(originScope(ids)))).toEqual({ out_for_delivery: 1, in_progress: 1 });
    const cancelled = await first(buildCancelledQuery(ranges, originScope([KTM], "p.")));
    expect(Number(cancelled.d2_cancelled)).toBe(1);
  });

  it("splits today by origin branch", async () => {
    const query = buildBranchTodayQuery(w.today);
    const rows = (await db.query(query.text, query.values)).rows;
    expect(rows).toEqual([
      { branch: "Kathmandu", orders: 2, delivered: 1, returned: 1, cod: "900.00" },
      { branch: "Pokhara", orders: 1, delivered: 0, returned: 0, cod: "0" },
    ]);
  });
});
