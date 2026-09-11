// listReturnManifests and getReturnManifestById used to ignore the actor
// entirely (`_actor`) - any admin saw every vendor's return manifest. These
// lock down the fix: a branch-scoped admin is limited to manifests whose
// vendor is registered at their branch, the same "is this vendor mine" rule
// assertBranchAdminOwnsVendor already applies elsewhere.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: {
    return_manifests: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    return_manifest_parcels: { findMany: vi.fn() },
  },
}));
vi.mock("../order.service", () => ({
  mapHandoverParcel: vi.fn((p: any) => ({ id: p.id, codAmount: 0 })),
  HANDOVER_PARCEL_INCLUDE: {},
  bulkUpdateParcelStatus: vi.fn(),
}));
vi.mock("../../lib/branchScope", () => ({
  adminBranchScopeIds: vi.fn(),
}));

import prisma from "../../lib/prisma";
import { adminBranchScopeIds } from "../../lib/branchScope";
import { listReturnManifests, getReturnManifestById } from "../returnManifest.service";

const mockedPrisma = prisma as unknown as {
  return_manifests: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  return_manifest_parcels: { findMany: ReturnType<typeof vi.fn> };
};
const mockedAdminBranchScopeIds = adminBranchScopeIds as unknown as ReturnType<typeof vi.fn>;

const HUB_ID = "hub-imadol";
const OTHER_HUB_ID = "hub-chitwan";
const SCOPED_ADMIN = { id: "admin-1", roles: ["admin"] };

function manifestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "manifest-1", manifest_no: "RTM-1", vendor_id: "vendor-1", status: "open",
    rider_id: null, sent_at: null, received_at: null, remarks: null,
    created_at: new Date(), updated_at: new Date(),
    vendors: { id: "vendor-1", client_name: "Acme", business_name: null, phone: "98", location_id: HUB_ID },
    _count: { return_manifest_parcels: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.return_manifest_parcels.findMany.mockResolvedValue([]);
});

describe("listReturnManifests", () => {
  it("scopes to vendors at the admin's branch when branch-scoped", async () => {
    mockedAdminBranchScopeIds.mockResolvedValue([HUB_ID]);
    mockedPrisma.return_manifests.findMany.mockResolvedValue([]);
    mockedPrisma.return_manifests.count.mockResolvedValue(0);

    await listReturnManifests(SCOPED_ADMIN, {});

    const where = mockedPrisma.return_manifests.findMany.mock.calls[0]![0].where;
    expect(where.vendors).toEqual({ location_id: { in: [HUB_ID] } });
  });

  it("applies no vendor filter when unrestricted", async () => {
    mockedAdminBranchScopeIds.mockResolvedValue(undefined);
    mockedPrisma.return_manifests.findMany.mockResolvedValue([]);
    mockedPrisma.return_manifests.count.mockResolvedValue(0);

    await listReturnManifests({ id: "root-1", roles: ["super_admin"] }, {});

    const where = mockedPrisma.return_manifests.findMany.mock.calls[0]![0].where;
    expect(where.vendors).toBeUndefined();
  });
});

describe("getReturnManifestById", () => {
  it("404s on a manifest whose vendor is outside the admin's branch", async () => {
    mockedAdminBranchScopeIds.mockResolvedValue([HUB_ID]);
    mockedPrisma.return_manifests.findUnique.mockResolvedValue(
      manifestRow({ vendors: { id: "vendor-1", client_name: "Acme", business_name: null, phone: "98", location_id: OTHER_HUB_ID } }),
    );

    await expect(getReturnManifestById(SCOPED_ADMIN, "manifest-1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("allows a manifest whose vendor is inside the admin's branch", async () => {
    mockedAdminBranchScopeIds.mockResolvedValue([HUB_ID]);
    mockedPrisma.return_manifests.findUnique.mockResolvedValue(manifestRow());

    await expect(getReturnManifestById(SCOPED_ADMIN, "manifest-1")).resolves.toBeDefined();
  });

  it("404s when the manifest doesn't exist at all", async () => {
    mockedAdminBranchScopeIds.mockResolvedValue(undefined);
    mockedPrisma.return_manifests.findUnique.mockResolvedValue(null);

    await expect(getReturnManifestById({ id: "root-1", roles: ["super_admin"] }, "nope")).rejects.toBeInstanceOf(AppError);
  });
});
