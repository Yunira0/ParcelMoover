// A branch-scoped admin manages Route Rates for their own hub only - these
// lock down that boundary (list, create/update, and activate-toggle) the same
// way order.service.branchScope.test.ts locks down parcel access. Everyone
// else (super_admin, a non-branch-scoped admin, an admin holding
// BRANCH_TRACKING_*, or Imadol) stays unrestricted.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    admins: { findFirst: vi.fn() },
    locations: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    delivery_rates: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

import {
  listDeliveryRates,
  upsertDeliveryRate,
  setDeliveryRateActive,
  deleteDeliveryRate,
  isBranchScopedAdmin,
} from "../delivery-rate.service";
import prisma from "../../lib/prisma";

const mockedPrisma = prisma as unknown as {
  admins: { findFirst: ReturnType<typeof vi.fn> };
  locations: { findUnique: ReturnType<typeof vi.fn> };
  delivery_rates: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const HUB_ID = "hub-hetauda";
const OTHER_HUB_ID = "hub-pokhara";

// A branch-scoped admin, no BRANCH_TRACKING grant - the ordinary case.
const SCOPED_ADMIN = { id: "admin-1", roles: ["admin"] };

function mockScopedAdmin(overrides: Record<string, unknown> = {}) {
  mockedPrisma.admins.findFirst.mockResolvedValue({
    location_id: HUB_ID,
    branch_scoped: true,
    permissions: [],
    locations: { code: "HET" },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.locations.findUnique.mockResolvedValue({ id: HUB_ID, is_active: true });
});

describe("listDeliveryRates", () => {
  it("scopes a branch admin to routes originating from their own hub", async () => {
    mockScopedAdmin();
    mockedPrisma.delivery_rates.findMany.mockResolvedValue([]);

    await listDeliveryRates(SCOPED_ADMIN);

    const args = mockedPrisma.delivery_rates.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ origin_location_id: HUB_ID });
  });

  it("leaves a super_admin unrestricted", async () => {
    mockedPrisma.delivery_rates.findMany.mockResolvedValue([]);

    await listDeliveryRates({ id: "root-1", roles: ["super_admin"] });

    const args = mockedPrisma.delivery_rates.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({});
    expect(mockedPrisma.admins.findFirst).not.toHaveBeenCalled();
  });

  it("leaves an admin holding BRANCH_TRACKING_READ unrestricted, same as order.service", async () => {
    mockScopedAdmin({ permissions: ["BRANCH_TRACKING_READ"] });
    mockedPrisma.delivery_rates.findMany.mockResolvedValue([]);

    await listDeliveryRates(SCOPED_ADMIN);

    const args = mockedPrisma.delivery_rates.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({});
  });

  it("leaves Imadol (the central hub) unrestricted", async () => {
    mockScopedAdmin({ locations: { code: "IMADOL" } });
    mockedPrisma.delivery_rates.findMany.mockResolvedValue([]);

    await listDeliveryRates(SCOPED_ADMIN);

    const args = mockedPrisma.delivery_rates.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({});
  });
});

describe("upsertDeliveryRate", () => {
  it("rejects a route whose origin is not the branch admin's own hub", async () => {
    mockScopedAdmin();

    await expect(
      upsertDeliveryRate(SCOPED_ADMIN, {
        originLocationId: OTHER_HUB_ID,
        destinationLocationId: "dest-1",
        baseCharge: 100,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockedPrisma.delivery_rates.upsert).not.toHaveBeenCalled();
  });

  it("allows a branch admin to set a rate originating from their own hub", async () => {
    mockScopedAdmin();
    mockedPrisma.delivery_rates.upsert.mockResolvedValue({ id: "rate-1" });

    await expect(
      upsertDeliveryRate(SCOPED_ADMIN, {
        originLocationId: HUB_ID,
        destinationLocationId: "dest-1",
        baseCharge: 100,
      }),
    ).resolves.toBeDefined();
  });

  it("never scopes a super_admin", async () => {
    mockedPrisma.delivery_rates.upsert.mockResolvedValue({ id: "rate-1" });

    await expect(
      upsertDeliveryRate(
        { id: "root-1", roles: ["super_admin"] },
        { originLocationId: OTHER_HUB_ID, destinationLocationId: "dest-1", baseCharge: 100 },
      ),
    ).resolves.toBeDefined();
    expect(mockedPrisma.admins.findFirst).not.toHaveBeenCalled();
  });
});

describe("setDeliveryRateActive", () => {
  it("404s toggling a rate that belongs to another hub", async () => {
    mockScopedAdmin();
    mockedPrisma.delivery_rates.findUnique.mockResolvedValue({
      id: "rate-1",
      origin_location_id: OTHER_HUB_ID,
      destination_location_id: "dest-1",
    });

    await expect(setDeliveryRateActive(SCOPED_ADMIN, "rate-1", false)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockedPrisma.delivery_rates.update).not.toHaveBeenCalled();
  });

  it("allows toggling a rate that originates from the branch admin's own hub", async () => {
    mockScopedAdmin();
    mockedPrisma.delivery_rates.findUnique.mockResolvedValue({
      id: "rate-1",
      origin_location_id: HUB_ID,
      destination_location_id: "dest-1",
    });
    mockedPrisma.delivery_rates.update.mockResolvedValue({ id: "rate-1", is_active: false });

    await expect(setDeliveryRateActive(SCOPED_ADMIN, "rate-1", false)).resolves.toBeDefined();
  });
});

describe("deleteDeliveryRate", () => {
  it("404s deleting a rate that belongs to another hub", async () => {
    mockScopedAdmin();
    mockedPrisma.delivery_rates.findUnique.mockResolvedValue({
      id: "rate-1",
      origin_location_id: OTHER_HUB_ID,
      destination_location_id: "dest-1",
    });

    await expect(deleteDeliveryRate(SCOPED_ADMIN, "rate-1")).rejects.toMatchObject({ statusCode: 404 });
    expect(mockedPrisma.delivery_rates.delete).not.toHaveBeenCalled();
  });

  it("allows deleting a rate that originates from the branch admin's own hub", async () => {
    mockScopedAdmin();
    mockedPrisma.delivery_rates.findUnique.mockResolvedValue({
      id: "rate-1",
      origin_location_id: HUB_ID,
      destination_location_id: "dest-1",
    });
    mockedPrisma.delivery_rates.delete.mockResolvedValue({ id: "rate-1" });

    await deleteDeliveryRate(SCOPED_ADMIN, "rate-1");
    expect(mockedPrisma.delivery_rates.delete).toHaveBeenCalledWith({ where: { id: "rate-1" } });
  });

  it("never scopes a super_admin", async () => {
    mockedPrisma.delivery_rates.findUnique.mockResolvedValue({
      id: "rate-1",
      origin_location_id: OTHER_HUB_ID,
      destination_location_id: "dest-1",
    });
    mockedPrisma.delivery_rates.delete.mockResolvedValue({ id: "rate-1" });

    await deleteDeliveryRate({ id: "root-1", roles: ["super_admin"] }, "rate-1");
    expect(mockedPrisma.delivery_rates.delete).toHaveBeenCalled();
    expect(mockedPrisma.admins.findFirst).not.toHaveBeenCalled();
  });
});

describe("isBranchScopedAdmin", () => {
  it("is true for a branch_scoped admin, even without SETTINGS_ACCESS", async () => {
    mockScopedAdmin();
    await expect(isBranchScopedAdmin(SCOPED_ADMIN)).resolves.toBe(true);
  });

  it("is false for a plain (non-branch-scoped) admin", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: null,
      branch_scoped: false,
      permissions: [],
    });
    await expect(isBranchScopedAdmin(SCOPED_ADMIN)).resolves.toBe(false);
  });

  it("is false for a super_admin (they never need the branch bypass)", async () => {
    await expect(isBranchScopedAdmin({ id: "root-1", roles: ["super_admin"] })).resolves.toBe(false);
    expect(mockedPrisma.admins.findFirst).not.toHaveBeenCalled();
  });
});
