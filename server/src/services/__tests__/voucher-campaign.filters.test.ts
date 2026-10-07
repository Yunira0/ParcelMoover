import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client";

const { db } = vi.hoisted(() => ({ db: {
  voucher_campaigns: { findUnique: vi.fn() }, $queryRaw: vi.fn(),
} }));
vi.mock("../../lib/prisma", () => ({ default: db }));
import { listCampaignCodes } from "../voucher-campaign.service";

// All SQL runs against a disposable in-memory fixture, never DATABASE_URL.
const sqlDb = new PGlite();
const campaignId = "11111111-1111-4111-8111-111111111111";
const admin = { id: "staff", roles: ["admin"] };

beforeAll(async () => {
  await sqlDb.exec(`
    CREATE TABLE vouchers (id text, code text, title text, description text, is_active boolean, expires_at timestamptz, campaign_id uuid);
    CREATE TABLE voucher_claims (id text, voucher_id text, vendor_id text, state text, claimed_at timestamptz);
    CREATE TABLE vendors (id text, business_name text, client_name text);
    INSERT INTO vendors VALUES ('vendor', 'Test shop', 'Owner');
  `);
  let n = 0;
  for (const active of [true, false]) {
    for (const expiry of ["2000-01-01", "2100-01-01"]) {
      for (const claim of [null, "claimed", "reserved", "used"]) {
        const id = `code-${++n}`;
        await sqlDb.query("INSERT INTO vouchers VALUES ($1,$1,'Title','Description',$2,$3,$4)", [id, active, expiry, campaignId]);
        if (claim) await sqlDb.query("INSERT INTO voucher_claims VALUES ($1,$1,'vendor',$2,now())", [id, claim]);
      }
    }
  }
});
afterAll(() => sqlDb.close());
beforeEach(() => {
  vi.clearAllMocks();
  db.voucher_campaigns.findUnique.mockResolvedValue({ id: campaignId });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = Prisma.sql(strings, ...values);
    return (await sqlDb.query(query.text, query.values)).rows;
  });
});

describe("voucher SQL filters match displayed states", () => {
  it.each([
    ["paused", 8], ["unclaimed", 1], ["expired", 1], ["claimed", 4], ["redeemed", 2],
  ] as const)("%s excludes every other displayed state and keeps an exact total", async (state, count) => {
    const result = await listCampaignCodes(admin, campaignId, { state });
    expect(result.total).toBe(count);
    expect(result.data).toHaveLength(count);
    expect(result.data.every(row => row.state === state)).toBe(true);
  });

  it("keeps all active and paused rows in the unfiltered list", async () => {
    const result = await listCampaignCodes(admin, campaignId, { state: "all" });
    expect(result.total).toBe(16);
    expect(result.data).toHaveLength(16);
  });

  it("retains the staff-only boundary before querying campaign data", async () => {
    await expect(listCampaignCodes({ id: "vendor", roles: ["vendor"] }, campaignId)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.voucher_campaigns.findUnique).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
