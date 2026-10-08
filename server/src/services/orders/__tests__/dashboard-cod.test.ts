import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";

vi.mock("../../../lib/prisma", () => ({ default: {} }));

import { BRANCH_CLEARED_SQL, BRANCH_OWED_SQL, PART_PAID_FRACTIONS_SQL, branchCodFilterSql } from "../cod-detail";
import { buildCodSummaryQuery, type CodSummaryRow } from "../dashboard-cod";

// Head office plus three branches, each with COD in a different state, run
// through the dashboard's real SQL. Branches is one figure for every branch
// together; per-branch scopes must add up to it.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IMADOL = id(1);
const IMADOL_AREA = id(2);
const POKHARA = id(10);
const BUTWAL = id(20);
const CHITWAN = id(30);
const IMADOL_RIDER = id(100);
const POKHARA_RIDER = id(110);
const BUTWAL_RIDER = id(120);
const CHITWAN_RIDER = id(130);
const NCM_RIDER = id(140);

type Parcel = {
  n: number;
  dest: string | null;
  rider: string;
  collected: number;
  riderRemitted?: number;
  vendorRemitted?: number;
  carrier?: "ncm";
  onManifest?: boolean;
  status?: string;
  deleted?: boolean;
  // Branch statement the parcel is on: status and paid share of its net payable.
  branchStatement?: { status: "pending" | "partially_paid" | "settled" | "cancelled"; paid: number; net: number };
};

const parcels: Parcel[] = [
  // Imadol: its own riders' cash is PM-Rider.
  { n: 1, dest: IMADOL, rider: IMADOL_RIDER, collected: 1000 },
  { n: 2, dest: IMADOL_AREA, rider: IMADOL_RIDER, collected: 500, riderRemitted: 500, vendorRemitted: 500 },
  // Came in on a manifest but delivered inside Imadol's coverage - still Imadol's.
  { n: 3, dest: IMADOL_AREA, rider: IMADOL_RIDER, collected: 700, onManifest: true },
  // On a manifest with no destination: must land in PM-Rider, not vanish.
  { n: 4, dest: null, rider: IMADOL_RIDER, collected: 300, onManifest: true },

  // Pokhara: one still with the rider, one already handed to the branch.
  { n: 10, dest: POKHARA, rider: POKHARA_RIDER, collected: 2000, onManifest: true },
  { n: 11, dest: POKHARA, rider: POKHARA_RIDER, collected: 1500, riderRemitted: 1500, onManifest: true },
  // Excluded: soft-deleted, and not delivered yet.
  { n: 12, dest: POKHARA, rider: POKHARA_RIDER, collected: 9999, onManifest: true, deleted: true },
  { n: 13, dest: POKHARA, rider: POKHARA_RIDER, collected: 8888, onManifest: true, status: "in_transit" },

  // Butwal: one statement settled in full, one 40% paid.
  { n: 20, dest: BUTWAL, rider: BUTWAL_RIDER, collected: 3000, riderRemitted: 3000, vendorRemitted: 3000, onManifest: true,
    branchStatement: { status: "settled", paid: 2900, net: 2900 } },
  { n: 21, dest: BUTWAL, rider: BUTWAL_RIDER, collected: 1000, riderRemitted: 1000, onManifest: true,
    branchStatement: { status: "partially_paid", paid: 380, net: 950 } },

  // Chitwan: rider part-remitted, a cancelled statement (owes it all again),
  // and an NCM delivery that is NCM's to pay, not the branch's.
  { n: 30, dest: CHITWAN, rider: CHITWAN_RIDER, collected: 2500, riderRemitted: 1000, onManifest: true },
  { n: 31, dest: CHITWAN, rider: CHITWAN_RIDER, collected: 800, riderRemitted: 800, onManifest: true,
    branchStatement: { status: "cancelled", paid: 0, net: 760 } },
  { n: 32, dest: CHITWAN, rider: NCM_RIDER, collected: 1200, carrier: "ncm", onManifest: true },
];

const db = new PGlite();
const masterCoverage = [IMADOL, IMADOL_AREA];
const branchFilter = branchCodFilterSql(masterCoverage);

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE riders (id uuid PRIMARY KEY, carrier_code text);
    CREATE TABLE parcels (id integer PRIMARY KEY, status text, deleted_at timestamptz, delivery_charge numeric,
      destination_location_id uuid);
    CREATE TABLE cod_collections (id integer PRIMARY KEY, parcel_id integer, rider_id uuid, carrier_code text,
      collected_amount numeric, remitted_amount numeric, rider_remitted_amount numeric, payment_status text,
      carrier_payment_status text, collected_at timestamptz);
    CREATE TABLE settlements (id integer PRIMARY KEY, status text, payee_type text, paid_amount numeric,
      payable_amount numeric, amount numeric);
    CREATE TABLE settlement_items (settlement_id integer, cod_collection_id integer);
    CREATE TABLE carrier_settlements (id integer PRIMARY KEY, paid_amount numeric, net_receivable numeric);
    CREATE TABLE carrier_settlement_items (settlement_id integer, cod_collection_id integer, net_amount numeric);
    CREATE TABLE branch_settlements (id integer PRIMARY KEY, status text, paid_amount numeric, net_payable numeric);
    CREATE TABLE branch_settlement_items (settlement_id integer, parcel_id integer UNIQUE);
    CREATE TABLE transit_manifest_parcels (parcel_id integer);
  `);
  for (const [rider, carrier] of [[IMADOL_RIDER, null], [POKHARA_RIDER, null], [BUTWAL_RIDER, null], [CHITWAN_RIDER, null], [NCM_RIDER, "ncm"]]) {
    await db.query("INSERT INTO riders VALUES ($1, $2)", [rider, carrier]);
  }
  for (const p of parcels) {
    await db.query("INSERT INTO parcels VALUES ($1, $2, $3, 100, $4)", [
      p.n, p.status ?? "delivered", p.deleted ? new Date() : null, p.dest,
    ]);
    await db.query("INSERT INTO cod_collections VALUES ($1, $1, $2, $3, $4, $5, $6, $7, 'pending', now())", [
      p.n, p.rider, p.carrier ?? null, p.collected, p.vendorRemitted ?? 0, p.riderRemitted ?? 0,
      p.vendorRemitted === p.collected ? "paid" : "pending",
    ]);
    if (p.onManifest) await db.query("INSERT INTO transit_manifest_parcels VALUES ($1)", [p.n]);
    if (p.branchStatement) {
      await db.query("INSERT INTO branch_settlements VALUES ($1, $2, $3, $4)", [
        p.n, p.branchStatement.status, p.branchStatement.paid, p.branchStatement.net,
      ]);
      await db.query("INSERT INTO branch_settlement_items VALUES ($1, $1)", [p.n]);
    }
  }
}, 20_000);
afterAll(() => db.close());

const summary = async (scope: Prisma.Sql = Prisma.empty, riderScoped = false) => {
  const query = buildCodSummaryQuery(scope, branchFilter, riderScoped);
  const { rows } = await db.query<Record<string, string>>(query.text, query.values);
  return Object.fromEntries(Object.entries(rows[0]!).map(([k, v]) => [k, Number(v)])) as Record<keyof CodSummaryRow, number>;
};
const forBranch = (branch: string) => Prisma.sql`AND p.destination_location_id = ${branch}::uuid`;

describe("COD Settlement card - Branches", () => {
  it("counts every branch's unpaid COD in one figure, wherever the cash sits", async () => {
    const s = await summary();
    // Pokhara 2000 (with rider) + 1500 (at branch)
    // Butwal 0 (settled) + 1000 * (1 - 380/950) = 600 (part-paid)
    // Chitwan 2500 (rider part-remitted: the branch still owes all of it) + 800 (cancelled statement)
    expect(s.cod_from_branches).toBe(3500 + 600 + 3300);
  });

  it("adds up per branch: Pokhara + Butwal + Chitwan = the Branches figure", async () => {
    const [pokhara, butwal, chitwan, all] = await Promise.all([
      summary(forBranch(POKHARA)), summary(forBranch(BUTWAL)), summary(forBranch(CHITWAN)), summary(),
    ]);
    expect(pokhara.cod_from_branches).toBe(3500);
    expect(butwal.cod_from_branches).toBe(600);
    expect(chitwan.cod_from_branches).toBe(3300);
    expect(pokhara.cod_from_branches + butwal.cod_from_branches + chitwan.cod_from_branches).toBe(all.cod_from_branches);
  });

  it("keeps branch riders' cash out of PM-Rider, so nothing is counted twice", async () => {
    const s = await summary();
    // Only Imadol's own riders: 1000 + 0 + 700 (Imadol-area manifest parcel) + 300 (no destination).
    expect(s.cod_from_pm_rider).toBe(2000);
    expect(s.cod_from_ncm).toBe(1200);
    for (const branch of [POKHARA, BUTWAL]) expect((await summary(forBranch(branch))).cod_from_pm_rider).toBe(0);
  });

  it("COD still to collect equals what each delivered parcel still owes Imadol", async () => {
    const s = await summary();
    const live = parcels.filter((p) => !p.deleted && !p.status);
    const isBranch = (p: Parcel) => !p.carrier && p.onManifest && p.dest !== null && !masterCoverage.includes(p.dest);
    const expected = live.reduce((sum, p) => {
      if (p.carrier) return sum + p.collected;
      if (isBranch(p)) {
        const b = p.branchStatement;
        const frac = !b || b.status === "pending" || b.status === "cancelled" ? 0 : b.status === "settled" ? 1 : b.paid / b.net;
        return sum + p.collected * (1 - frac);
      }
      return sum + p.collected - (p.riderRemitted ?? 0);
    }, 0);
    expect(s.cod_from_pm_rider + s.cod_from_ncm + s.cod_from_upaya + s.cod_from_branches).toBeCloseTo(expected, 6);
  });

  it("keeps Total / Settled / Pending (gross) consistent", async () => {
    const s = await summary();
    const live = parcels.filter((p) => !p.deleted && !p.status);
    expect(s.total_collected).toBe(live.reduce((sum, p) => sum + p.collected, 0));
    expect(s.settled_to_vendor).toBe(500 + 3000);
    // Pending (gross) on the card is total - settled.
    expect(s.total_collected - s.settled_to_vendor).toBe(14500 - 3500);
  });

  it("leaves a rider's own card counting all the cash they hold", async () => {
    const s = await summary(Prisma.sql`AND c.rider_id = ${CHITWAN_RIDER}::uuid`, true);
    expect(s.cod_from_pm_rider).toBe(2500 - 1000);
  });

  it("drill-down rows (branches bucket) add up to the card figure", async () => {
    const query = Prisma.sql`
      SELECT p.id, (${BRANCH_OWED_SQL}) AS owed
      FROM cod_collections c
      JOIN parcels p ON p.id = c.parcel_id
      LEFT JOIN riders r ON r.id = c.rider_id
      LEFT JOIN LATERAL (${PART_PAID_FRACTIONS_SQL}) pp ON TRUE
      LEFT JOIN LATERAL (${BRANCH_CLEARED_SQL}) bs ON TRUE
      WHERE p.deleted_at IS NULL AND c.collected_at IS NOT NULL
        AND p.status IN ('delivered', 'partially_delivered', 'returned_to_vendor')
        AND ${branchFilter} AND ${BRANCH_OWED_SQL} > 0
      ORDER BY p.id`;
    const { rows } = await db.query<{ id: number; owed: string }>(query.text, query.values);
    expect(rows.map((r) => r.id)).toEqual([10, 11, 21, 30, 31]);
    expect(rows.reduce((sum, r) => sum + Number(r.owed), 0)).toBe((await summary()).cod_from_branches);
  });

  it("with no Imadol hub configured, every manifest parcel with a destination is branch COD", async () => {
    const query = buildCodSummaryQuery(Prisma.empty, branchCodFilterSql([]), false);
    const { rows } = await db.query<Record<string, string>>(query.text, query.values);
    // Parcel 3 (Imadol area, on a manifest) moves to Branches; nothing is lost.
    expect(Number(rows[0]!.cod_from_branches)).toBe(7400 + 700);
    expect(Number(rows[0]!.cod_from_pm_rider)).toBe(2000 - 700);
  });
});
