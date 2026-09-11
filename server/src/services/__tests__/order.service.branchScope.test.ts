// getAdminBranchScope restricts order visibility to any admin who simply has
// a hub assigned - Imadol included, unlike every other branch-scoping check
// in the app (which key off branch_scoped and stay unrestricted at Imadol).
// These lock down the actual security boundary it creates: a hub-assigned
// admin can't act on (or, via buildOrdersWhere/getStatusCounts, even see) a
// parcel that doesn't touch their hub - and everyone else's behaviour is
// completely unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findFirst: vi.fn(), findMany: vi.fn() },
    admins: { findFirst: vi.fn() },
    locations: { findUnique: vi.fn() },
    riders: { findFirst: vi.fn() },
    run_sheets: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../accounting/sync", () => ({
  syncParcelPostings: vi.fn().mockResolvedValue(undefined),
  syncParcelPostingsAsync: vi.fn(),
}));
vi.mock("../../lib/redis", () => ({
  default: { set: vi.fn(), del: vi.fn(), get: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../vendor-scope.service", () => ({
  resolveOwnVendorId: vi.fn().mockResolvedValue(null),
  isStaffActor: vi.fn().mockReturnValue(true),
}));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../branch.service", () => ({ resolveBranchLocationIds: vi.fn() }));

import {
  updateParcelStatus,
  bulkUpdateParcelStatus,
  updateOrderDetails,
  redirectOrder,
  getRiderRunSheet,
} from "../order.service";
import prisma from "../../lib/prisma";
import { resolveBranchLocationIds } from "../branch.service";

const mockedPrisma = prisma as unknown as {
  parcels: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  admins: { findFirst: ReturnType<typeof vi.fn> };
  run_sheets: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedResolveBranchLocationIds = resolveBranchLocationIds as unknown as ReturnType<typeof vi.fn>;

const HUB_ID = "hub-imadol";
const AREA_ID = "area-lakeside";
const OTHER_HUB_ID = "hub-chitwan";

// A branch-scoped admin, no BRANCH_TRACKING grant - the ordinary case.
const SCOPED_ADMIN = { id: "admin-1", roles: ["admin"] };

function makeMockTx() {
  return {
    pickup_tasks: { update: vi.fn(), updateMany: vi.fn() },
    parcels: {
      update: vi.fn().mockResolvedValue({ id: "parcel-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    parcel_status_history: { create: vi.fn(), createMany: vi.fn() },
    parcel_remarks: { create: vi.fn(), createMany: vi.fn() },
    audit_logs: { create: vi.fn(), createMany: vi.fn() },
    cod_collections: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    run_sheets: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    run_sheet_parcels: { createMany: vi.fn() },
    dispatches: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    dispatch_parcels: { createMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    transit_manifest_parcels: { deleteMany: vi.fn() },
    return_manifest_parcels: { deleteMany: vi.fn() },
    webhook_endpoints: { findMany: vi.fn().mockResolvedValue([]) },
    webhook_deliveries: { createMany: vi.fn() },
  };
}

function makeFakeParcel(overrides: Record<string, unknown> = {}) {
  return {
    id: "parcel-1",
    status: "ready_to_deliver",
    vendor_id: null,
    tracking_id: "TRK-1",
    origin_location_id: HUB_ID,
    current_location_id: HUB_ID,
    destination_location_id: HUB_ID,
    pickup_rider_id: null,
    delivery_rider_id: null,
    cod_amount: 0,
    delivery_charge: 0,
    order_type: "forward",
    pickup_tasks: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(makeMockTx()));
  // Branch covers itself, one covered area, and nothing else - Chitwan is a
  // different branch entirely.
  mockedResolveBranchLocationIds.mockResolvedValue([HUB_ID, AREA_ID]);
});

describe("a branch-scoped admin (single-parcel path)", () => {
  it("acts on a parcel that touches their branch", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: [],
    });
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "ready_to_deliver", destination_location_id: AREA_ID }),
    );

    await expect(
      updateParcelStatus(SCOPED_ADMIN, "parcel-1", { status: "hold" }),
    ).resolves.toBeDefined();
  });

  it("404s on a parcel that never touches their branch", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: [],
    });
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({
        origin_location_id: OTHER_HUB_ID,
        current_location_id: OTHER_HUB_ID,
        destination_location_id: OTHER_HUB_ID,
      }),
    );

    await expect(
      updateParcelStatus(SCOPED_ADMIN, "parcel-1", { status: "hold" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // Unlike every other branch-scoping check in the app (remarks, COD
  // settlement, vendor/rider management, etc. - all keyed on branch_scoped
  // and unrestricted at Imadol), order visibility keys off having a hub
  // assigned at all. branch_scoped plays no part, and neither does which hub
  // it is - an Imadol-based admin (branch_scoped auto-derived false, so their
  // remarks/COD-settlement stay unrestricted) is narrowed to their own hub's
  // orders exactly like any other branch.
  it("restricts purely by having a hub assigned - branch_scoped plays no part", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, permissions: [],
    });
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "hold", origin_location_id: OTHER_HUB_ID, current_location_id: OTHER_HUB_ID, destination_location_id: OTHER_HUB_ID }),
    );

    await expect(
      updateParcelStatus(SCOPED_ADMIN, "parcel-1", { status: "ready_to_deliver" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("is unrestricted once granted BRANCH_TRACKING_READ, the same rule Branch Tracking itself uses", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: ["BRANCH_TRACKING_READ"],
    });
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "hold", origin_location_id: OTHER_HUB_ID, current_location_id: OTHER_HUB_ID, destination_location_id: OTHER_HUB_ID }),
    );

    await expect(
      updateParcelStatus(SCOPED_ADMIN, "parcel-1", { status: "ready_to_deliver" }),
    ).resolves.toBeDefined();
  });

  it("never scopes a super_admin, even if their own admins row is branch_scoped", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: [],
    });
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "hold", origin_location_id: OTHER_HUB_ID, current_location_id: OTHER_HUB_ID, destination_location_id: OTHER_HUB_ID }),
    );

    await expect(
      updateParcelStatus({ id: "root-1", roles: ["super_admin"] }, "parcel-1", { status: "ready_to_deliver" }),
    ).resolves.toBeDefined();
    expect(mockedPrisma.admins.findFirst).not.toHaveBeenCalled();
  });
});

describe("a branch-scoped admin (bulk path)", () => {
  it("drops an out-of-branch id the same way an out-of-vendor one is dropped", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: [],
    });
    // Only one of the two requested ids actually matches the branch filter -
    // the mock simulates the DB dropping the other one, same as a real query.
    mockedPrisma.parcels.findMany.mockResolvedValue([makeFakeParcel({ id: "parcel-1" })]);

    await expect(
      bulkUpdateParcelStatus(SCOPED_ADMIN, { ids: ["parcel-1", "parcel-2"], status: "hold" }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const where = mockedPrisma.parcels.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { origin_location_id: { in: [HUB_ID, AREA_ID] } },
      { destination_location_id: { in: [HUB_ID, AREA_ID] } },
      { current_location_id: { in: [HUB_ID, AREA_ID] } },
    ]);
  });
});

// updateOrderDetails, redirectOrder and getRiderRunSheet used to look the
// parcel/rider up with no branch filter at all - a branch-scoped admin could
// act on (or run-sheet) anything system-wide by id even though listOrders
// already hid it from them. These lock down the fix.
describe("a branch-scoped admin (updateOrderDetails)", () => {
  it("404s on a parcel that never touches their branch", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: [],
    });
    mockedPrisma.parcels.findFirst.mockResolvedValue(null);

    await expect(
      updateOrderDetails(SCOPED_ADMIN, "parcel-1", {}),
    ).rejects.toMatchObject({ statusCode: 404 });

    const where = mockedPrisma.parcels.findFirst.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { origin_location_id: { in: [HUB_ID, AREA_ID] } },
      { destination_location_id: { in: [HUB_ID, AREA_ID] } },
      { current_location_id: { in: [HUB_ID, AREA_ID] } },
    ]);
  });

  it("applies no branch filter for a super_admin", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(null);

    await expect(
      updateOrderDetails({ id: "root-1", roles: ["super_admin"] }, "parcel-1", {}),
    ).rejects.toMatchObject({ statusCode: 404 });

    const where = mockedPrisma.parcels.findFirst.mock.calls[0]![0].where;
    expect(where.OR).toBeUndefined();
  });
});

describe("a branch-scoped admin (redirectOrder)", () => {
  it("404s on a parcel that never touches their branch", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: [],
    });
    mockedPrisma.parcels.findFirst.mockResolvedValue(null);

    await expect(
      redirectOrder(SCOPED_ADMIN, "parcel-1", {
        destinationLocationId: "dest-1", address: "New address", reason: "Customer moved", redirectCharge: 0,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const where = mockedPrisma.parcels.findFirst.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { origin_location_id: { in: [HUB_ID, AREA_ID] } },
      { destination_location_id: { in: [HUB_ID, AREA_ID] } },
      { current_location_id: { in: [HUB_ID, AREA_ID] } },
    ]);
  });
});

describe("a branch-scoped admin (getRiderRunSheet)", () => {
  it("only queries run sheets for riders based at their branch", async () => {
    mockedPrisma.admins.findFirst.mockResolvedValue({
      location_id: HUB_ID, branch_scoped: true, permissions: [],
    });
    mockedPrisma.run_sheets.findMany.mockResolvedValue([]);

    await getRiderRunSheet(SCOPED_ADMIN, {});

    const where = mockedPrisma.run_sheets.findMany.mock.calls[0]![0].where;
    expect(where.riders).toEqual({ location_id: { in: [HUB_ID, AREA_ID] } });
  });

  it("applies no rider filter for a super_admin", async () => {
    mockedPrisma.run_sheets.findMany.mockResolvedValue([]);

    await getRiderRunSheet({ id: "root-1", roles: ["super_admin"] }, {});

    const where = mockedPrisma.run_sheets.findMany.mock.calls[0]![0].where;
    expect(where.riders).toBeUndefined();
  });
});
