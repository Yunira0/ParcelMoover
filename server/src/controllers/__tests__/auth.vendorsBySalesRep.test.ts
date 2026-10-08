import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  vendors: { count: vi.fn(), findMany: vi.fn() },
  parcels: { groupBy: vi.fn() },
  cod_collections: { groupBy: vi.fn() },
  vendor_staff: { findFirst: vi.fn() },
}));

vi.mock("../../services/auth.service", () => ({}));
vi.mock("../../services/vendorVolume.service", () => ({ rankHighVolumeVendors: vi.fn() }));
vi.mock("../../lib/tokenRevocation", () => ({ revokeToken: vi.fn() }));
vi.mock("../../lib/branchScope", () => ({ adminBranchScopeIds: vi.fn(async () => undefined) }));
vi.mock("../../lib/prisma", () => ({ default: db }));

import { getVendorsController } from "../auth.controller";

const rep = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function response() {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

const call = async (roles: string[], query: Record<string, string>, userId = "actor") => {
  const res = response();
  await getVendorsController({ user: { id: userId, roles }, query } as any, res);
  return res;
};
const where = () => db.vendors.count.mock.calls[0]![0].where;

describe("GET /auth/users/vendors - salesUserId (Sales Overview vendor table)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.vendors.count.mockResolvedValue(0);
    db.vendors.findMany.mockResolvedValue([]);
  });

  it("narrows staff to one sales rep's vendors", async () => {
    const res = await call(["super_admin"], { salesUserId: rep });
    expect(res.statusCode).toBe(200);
    expect(where()).toMatchObject({ deleted_at: null, sales_user_id: rep });
  });

  it("rejects a malformed id", async () => {
    const res = await call(["admin"], { salesUserId: "not-a-uuid" });
    expect(res.statusCode).toBe(400);
    expect(db.vendors.count).not.toHaveBeenCalled();
  });

  it("never lets a sales account read another rep's vendors", async () => {
    await call(["sales"], { salesUserId: rep }, "own-sales-user");
    expect(where().sales_user_id).toBe("own-sales-user");
  });

  it("leaves the list unfiltered without it", async () => {
    await call(["admin"], {});
    expect(where()).not.toHaveProperty("sales_user_id");
  });
});
