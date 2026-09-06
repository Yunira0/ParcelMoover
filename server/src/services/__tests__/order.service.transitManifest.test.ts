// A Transit → dispatched move that names no destination used to leave no
// hand-over document at all: the parcels went on the road and nothing recorded
// which truck carried them. bulkUpdateParcelStatus now opens a transit manifest
// for the route itself. These cover the routing decisions that behaviour turns
// on - one manifest per destination hub, reuse of a free open manifest, and
// keeping out of the flows that already have their own document.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findFirst: vi.fn(), findMany: vi.fn() },
    locations: { findUnique: vi.fn(), findMany: vi.fn() },
    vendors: { findUnique: vi.fn(), findMany: vi.fn() },
    riders: { findFirst: vi.fn(), findUnique: vi.fn() },
    cod_collections: { findFirst: vi.fn(), findMany: vi.fn() },
    transit_manifests: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    transit_manifest_parcels: { createMany: vi.fn() },
    audit_logs: { create: vi.fn() },
    // Not branch-scoped by default - see getAdminBranchScope in order.service.ts.
    admins: { findFirst: vi.fn().mockResolvedValue(null) },
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
  resolveOwnVendorId: vi.fn(),
  isStaffActor: vi.fn().mockReturnValue(false),
}));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));

import { bulkUpdateParcelStatus } from "../order.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";

const mockedPrisma = prisma as unknown as {
  parcels: { findMany: ReturnType<typeof vi.fn> };
  locations: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  transit_manifests: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  transit_manifest_parcels: { createMany: ReturnType<typeof vi.fn> };
  audit_logs: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedRedis = redis as unknown as {
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

const ADMIN = { id: "admin-1", roles: ["admin"] };

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
    dispatches: {
      create: vi.fn().mockResolvedValue({ id: "d-1", dispatch_no: "DSP-0007" }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    dispatch_parcels: { createMany: vi.fn() },
    return_manifest_parcels: { deleteMany: vi.fn() },
    transit_manifests: { updateMany: vi.fn(), update: vi.fn() },
    transit_manifest_parcels: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    webhook_endpoints: { findMany: vi.fn().mockResolvedValue([]) },
    webhook_deliveries: { createMany: vi.fn() },
  };
}

/**
 * The route split calls the impl once per manifest, so findMany has to honour
 * the id filter it's given - a mock that always returns the whole fixture would
 * fail the "every id was found" check on those narrower calls.
 */
function givenParcels(parcels: ReturnType<typeof oovParcel>[]) {
  mockedPrisma.parcels.findMany.mockImplementation(({ where }: any) => {
    const wanted: string[] | undefined = where?.id?.in;
    return Promise.resolve(
      parcels
        .filter((p) => !wanted || wanted.includes(p.id))
        .filter((p) => !where?.status || p.status === where.status),
    );
  });
}

function oovParcel(id: string, destinationLocationId: string) {
  return {
    id,
    status: "oov",
    vendor_id: null,
    tracking_id: `TRK-${id}`,
    current_location_id: "hub-ktm",
    destination_location_id: destinationLocationId,
    pickup_rider_id: null,
    delivery_rider_id: null,
    cod_amount: 0,
    delivery_charge: 0,
    order_type: "forward",
    pickup_tasks: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRedis.set.mockResolvedValue("OK");
  mockedRedis.del.mockResolvedValue(1);
  mockedRedis.get.mockResolvedValue(null);
  mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) =>
    fn(makeMockTx()),
  );
  // Kathmandu is the origin hub; Pokhara is a hub and Lakeside a covered area
  // under it, so both destinations resolve to the one Pokhara manifest.
  mockedPrisma.locations.findMany.mockResolvedValue([
    { id: "hub-ktm", name: "Kathmandu", locations: null },
    { id: "hub-pkr", name: "Pokhara", locations: null },
    { id: "area-lakeside", name: "Lakeside", locations: { id: "hub-pkr", name: "Pokhara" } },
    { id: "hub-btl", name: "Butwal", locations: null },
  ]);
  mockedPrisma.transit_manifests.findFirst.mockResolvedValue(null);
  mockedPrisma.transit_manifests.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `manifest-for-${data.to_location_id}` }),
  );
  // Two callers, one method: the manifest-no probe wants a miss (the number is
  // free), the pre-transaction read of the driving manifest wants a hit.
  mockedPrisma.transit_manifests.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.manifest_no ? null : { id: where.id, manifest_no: "TRM-TEST" }),
  );
});

describe("dispatching out of Transit opens a manifest for the route", () => {
  it("opens one for the destination hub and puts the parcels on it", async () => {
    givenParcels([oovParcel("parcel-1", "hub-pkr")]);

    await bulkUpdateParcelStatus(ADMIN, { ids: ["parcel-1"], status: "dispatched" });

    expect(mockedPrisma.transit_manifests.create).toHaveBeenCalledTimes(1);
    const created = mockedPrisma.transit_manifests.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({
      status: "open",
      from_location_id: "hub-ktm",
      to_location_id: "hub-pkr",
      from_hub: "Kathmandu",
      to_hub: "Pokhara",
    });
    expect(mockedPrisma.transit_manifest_parcels.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ transit_manifest_id: "manifest-for-hub-pkr", parcel_id: "parcel-1" }],
      }),
    );
  });

  it("bills a covered area to its parent hub's manifest", async () => {
    givenParcels([
      oovParcel("parcel-1", "hub-pkr"),
      oovParcel("parcel-2", "area-lakeside"),
    ]);

    await bulkUpdateParcelStatus(ADMIN, { ids: ["parcel-1", "parcel-2"], status: "dispatched" });

    expect(mockedPrisma.transit_manifests.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.transit_manifest_parcels.createMany.mock.calls[0]![0].data).toEqual([
      { transit_manifest_id: "manifest-for-hub-pkr", parcel_id: "parcel-1" },
      { transit_manifest_id: "manifest-for-hub-pkr", parcel_id: "parcel-2" },
    ]);
  });

  it("splits parcels bound for different branches onto a manifest each", async () => {
    givenParcels([
      oovParcel("parcel-1", "hub-pkr"),
      oovParcel("parcel-2", "hub-btl"),
    ]);

    await bulkUpdateParcelStatus(ADMIN, { ids: ["parcel-1", "parcel-2"], status: "dispatched" });

    expect(mockedPrisma.transit_manifests.create).toHaveBeenCalledTimes(2);
    expect(
      mockedPrisma.transit_manifests.create.mock.calls.map((call) => call[0].data.to_location_id),
    ).toEqual(["hub-pkr", "hub-btl"]);
  });

  it("reuses a free open manifest for the route instead of opening a second", async () => {
    givenParcels([oovParcel("parcel-1", "hub-pkr")]);
    mockedPrisma.transit_manifests.findFirst.mockResolvedValue({
      id: "manifest-open",
      _count: { transit_manifest_parcels: 3 },
    });

    await bulkUpdateParcelStatus(ADMIN, { ids: ["parcel-1"], status: "dispatched" });

    expect(mockedPrisma.transit_manifests.create).not.toHaveBeenCalled();
    expect(mockedPrisma.transit_manifest_parcels.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ transit_manifest_id: "manifest-open", parcel_id: "parcel-1" }],
      }),
    );
  });

  it("leaves a dispatch to a named destination alone - it already has one", async () => {
    givenParcels([oovParcel("parcel-1", "hub-pkr")]);
    mockedPrisma.locations.findUnique.mockResolvedValue({ id: "hub-pkr", is_active: true });

    await bulkUpdateParcelStatus(ADMIN, {
      ids: ["parcel-1"],
      status: "dispatched",
      toLocationId: "hub-pkr",
    });

    expect(mockedPrisma.transit_manifests.create).not.toHaveBeenCalled();
    expect(mockedPrisma.transit_manifest_parcels.createMany).not.toHaveBeenCalled();
  });

  it("leaves a manifest scan alone - it brought its own", async () => {
    givenParcels([oovParcel("parcel-1", "hub-pkr")]);

    await bulkUpdateParcelStatus(ADMIN, {
      ids: ["parcel-1"],
      status: "dispatched",
      transitManifestId: "manifest-scanned",
    });

    expect(mockedPrisma.transit_manifests.create).not.toHaveBeenCalled();
    expect(mockedPrisma.transit_manifest_parcels.createMany).not.toHaveBeenCalled();
  });
});
