// End-to-end coverage of the scan → dispatch → receive flow that drives the
// Open Manifest / Receive Manifest tabs, plus the pieces that make staging
// safe: destination coverage, capacity, and status guards. bulkUpdateParcelStatus
// itself is mocked - its own correctness is covered exhaustively elsewhere
// (order.service.riderScope/cancellation/transitManifest tests); this file's
// job is to verify what transitManifest.service does around it: which members
// it hands over, which it skips, and when it refuses to act at all.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findMany: vi.fn() },
    locations: { findFirst: vi.fn(), findMany: vi.fn() },
    transit_manifests: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    transit_manifest_parcels: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    audit_logs: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../order.service", () => ({
  bulkUpdateParcelStatus: vi.fn(),
  mapHandoverParcel: vi.fn((p: any) => ({ id: p.id, trackingId: p.tracking_id, codAmount: 0 })),
  HANDOVER_PARCEL_INCLUDE: {},
}));
vi.mock("../branch.service", () => ({
  resolveBranchLocationIds: vi.fn(),
}));
vi.mock("../branch-billing.service", () => ({
  assertBranchCanReceiveTransit: vi.fn(),
}));
vi.mock("../../lib/branchScope", () => ({
  adminBranchScopeIds: vi.fn().mockResolvedValue(undefined),
}));

import prisma from "../../lib/prisma";
import { bulkUpdateParcelStatus, mapHandoverParcel } from "../order.service";
import { resolveBranchLocationIds } from "../branch.service";
import { assertBranchCanReceiveTransit } from "../branch-billing.service";
import {
  addParcelsToTransitManifest,
  deleteTransitManifest,
  dispatchTransitManifest,
  receiveTransitManifestParcels,
  removeParcelFromTransitManifest,
  stageOrdersToBranch,
} from "../transitManifest.service";

const mockedPrisma = prisma as unknown as {
  parcels: { findMany: ReturnType<typeof vi.fn> };
  locations: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  transit_manifests: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  transit_manifest_parcels: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  audit_logs: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedBulkUpdate = bulkUpdateParcelStatus as unknown as ReturnType<typeof vi.fn>;
const mockedCoverage = resolveBranchLocationIds as unknown as ReturnType<typeof vi.fn>;
const mockedTransitGate = assertBranchCanReceiveTransit as unknown as ReturnType<typeof vi.fn>;
const mockedMapHandoverParcel = mapHandoverParcel as unknown as ReturnType<typeof vi.fn>;

const ADMIN = { id: "admin-1", roles: ["admin"] };
const MANIFEST_ID = "manifest-1";
const HUB_ID = "hub-pokhara";

function manifestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MANIFEST_ID,
    manifest_no: "TRM-1",
    status: "open",
    from_location_id: "hub-kathmandu",
    to_location_id: HUB_ID,
    from_hub: "Kathmandu",
    to_hub: "Pokhara",
    remarks: null,
    created_at: new Date(),
    updated_at: new Date(),
    dispatched_at: null,
    received_at: null,
    created_by: null,
    dispatched_by: null,
    received_by: null,
    _count: { transit_manifest_parcels: 0 },
    ...overrides,
  };
}

function parcelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "parcel-1",
    tracking_id: "TRK-1",
    status: "oov",
    current_location_id: "hub-kathmandu",
    destination_location_id: HUB_ID,
    ...overrides,
  };
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): also drops any queued mockResolvedValueOnce
  // left over from a previous test, so one test's call count never leaks into
  // the next test sharing the same mocked prisma method.
  vi.resetAllMocks();
  mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockedPrisma),
  );
  // Pokhara covers itself and one covered area by default.
  mockedCoverage.mockResolvedValue([HUB_ID, "area-lakeside"]);
  mockedTransitGate.mockResolvedValue(undefined);
  mockedMapHandoverParcel.mockImplementation((p: any) => ({ id: p.id, trackingId: p.tracking_id, codAmount: 0 }));
  // Base fallback for calls a test doesn't specifically queue - chiefly every
  // function's own trailing getTransitManifestById(), which re-fetches
  // membership to build its return value and doesn't need a rigged answer.
  mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([]);
});

describe("addParcelsToTransitManifest — staging a scan onto an open manifest", () => {
  it("links an oov parcel without touching its status", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([]);
    mockedPrisma.parcels.findMany.mockResolvedValue([parcelRow()]);

    const result = await addParcelsToTransitManifest(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] });

    expect(mockedBulkUpdate).not.toHaveBeenCalled();
    expect(mockedPrisma.transit_manifest_parcels.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ transit_manifest_id: MANIFEST_ID, parcel_id: "parcel-1" }] }),
    );
    expect(result.added).toBe(1);
    expect(result.rejected).toEqual([]);
  });

  it("rejects a parcel whose destination the manifest's branch doesn't cover", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([]);
    mockedPrisma.parcels.findMany.mockResolvedValue([
      parcelRow({ tracking_id: "TRK-2", destination_location_id: "hub-butwal" }),
    ]);

    await expect(
      addParcelsToTransitManifest(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-2"] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("Destination is not covered by Pokhara") });
    expect(mockedPrisma.transit_manifest_parcels.createMany).not.toHaveBeenCalled();
  });

  it("rejects a parcel that isn't oov, itemised by tracking id", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([]);
    mockedPrisma.parcels.findMany.mockResolvedValue([parcelRow({ status: "delivered" })]);

    await expect(
      addParcelsToTransitManifest(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] }),
    ).rejects.toMatchObject({ message: expect.stringContaining('"delivered", not in transit') });
  });

  it("treats rescanning an already-linked parcel as a no-op, not an error", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    // Two calls share this mock: the alreadyLinked query, then liveMemberships'
    // own lookup (which needs the fuller { transit_manifest_id, transit_manifests } shape).
    mockedPrisma.transit_manifest_parcels.findMany
      .mockResolvedValueOnce([{ parcel_id: "parcel-1" }])
      .mockResolvedValueOnce([]);
    mockedPrisma.parcels.findMany.mockResolvedValue([parcelRow()]);

    const result = await addParcelsToTransitManifest(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] });

    expect(result.added).toBe(0);
    expect(result.alreadyOnManifest).toBe(1);
    expect(mockedPrisma.transit_manifest_parcels.createMany).not.toHaveBeenCalled();
  });

  it("refuses to add to a manifest that has already been dispatched", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "dispatched" }));

    await expect(
      addParcelsToTransitManifest(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("branch billing transit gate", () => {
  it("refuses staging to a branch whose COD credit limit is blocked", async () => {
    mockedPrisma.locations.findFirst.mockResolvedValue({ id: HUB_ID, name: "Pokhara" });
    mockedTransitGate.mockRejectedValue({ statusCode: 403, code: "BRANCH_BILLING_BLOCKED", message: "Pokhara cannot receive transit" });

    await expect(stageOrdersToBranch(ADMIN, { toBranchId: HUB_ID, parcelIds: ["parcel-1"] })).rejects.toMatchObject({
      statusCode: 403,
      code: "BRANCH_BILLING_BLOCKED",
    });
    expect(mockedPrisma.parcels.findMany).not.toHaveBeenCalled();
  });

  it("checks the credit limit again immediately before dispatch", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedTransitGate.mockRejectedValue({ statusCode: 403, code: "BRANCH_BILLING_BLOCKED" });

    await expect(dispatchTransitManifest(ADMIN, MANIFEST_ID)).rejects.toMatchObject({ code: "BRANCH_BILLING_BLOCKED" });
    expect(mockedBulkUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteTransitManifest — cleaning up one opened by mistake", () => {
  it("deletes an empty open manifest", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());

    await deleteTransitManifest(ADMIN, MANIFEST_ID);

    expect(mockedPrisma.transit_manifests.delete).toHaveBeenCalledWith({ where: { id: MANIFEST_ID } });
  });

  it("refuses a manifest that still holds orders", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(
      manifestRow({ _count: { transit_manifest_parcels: 2 } }),
    );

    await expect(deleteTransitManifest(ADMIN, MANIFEST_ID)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockedPrisma.transit_manifests.delete).not.toHaveBeenCalled();
  });

  it("refuses a manifest that has already left - it's a record, not a mistake", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "dispatched" }));

    await expect(deleteTransitManifest(ADMIN, MANIFEST_ID)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockedPrisma.transit_manifests.delete).not.toHaveBeenCalled();
  });
});

describe("removeParcelFromTransitManifest — pulling a staged parcel back off", () => {
  it("unlinks it while the manifest is still open", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.deleteMany.mockResolvedValue({ count: 1 });
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([]);

    await removeParcelFromTransitManifest(ADMIN, MANIFEST_ID, "parcel-1");

    expect(mockedPrisma.transit_manifest_parcels.deleteMany).toHaveBeenCalledWith({
      where: { transit_manifest_id: MANIFEST_ID, parcel_id: "parcel-1" },
    });
  });

  it("404s when the parcel isn't actually on this manifest", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.deleteMany.mockResolvedValue({ count: 0 });

    await expect(removeParcelFromTransitManifest(ADMIN, MANIFEST_ID, "parcel-1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("refuses once the manifest has left - its contents are a record of what went out", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "dispatched" }));

    await expect(removeParcelFromTransitManifest(ADMIN, MANIFEST_ID, "parcel-1")).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe("dispatchTransitManifest — the truck leaves", () => {
  it("hands every staged (oov) member to bulkUpdateParcelStatus as one dispatched batch", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([
      { parcels: parcelRow({ id: "p1", tracking_id: "TRK-1" }) },
      { parcels: parcelRow({ id: "p2", tracking_id: "TRK-2" }) },
    ]);
    mockedBulkUpdate.mockResolvedValue({ updatedCount: 2, status: "dispatched" });

    const result = await dispatchTransitManifest(ADMIN, MANIFEST_ID);

    expect(mockedBulkUpdate).toHaveBeenCalledWith(
      { id: ADMIN.id, roles: ADMIN.roles },
      expect.objectContaining({
        ids: ["p1", "p2"],
        status: "dispatched",
        toLocationId: HUB_ID,
        transitManifestId: MANIFEST_ID,
      }),
    );
    expect(result.updated).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it("skips a member no longer oov instead of failing the whole dispatch", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([
      { parcels: parcelRow({ id: "p1", tracking_id: "TRK-1" }) },
      { parcels: parcelRow({ id: "p2", tracking_id: "TRK-2", status: "hold" }) },
    ]);
    mockedBulkUpdate.mockResolvedValue({ updatedCount: 1, status: "dispatched" });

    const result = await dispatchTransitManifest(ADMIN, MANIFEST_ID);

    expect(mockedBulkUpdate).toHaveBeenCalledWith(
      { id: ADMIN.id, roles: ADMIN.roles },
      expect.objectContaining({ ids: ["p1"] }),
    );
    expect(result.skipped).toEqual([{ trackingId: "TRK-2", status: "hold" }]);
  });

  it("refuses to dispatch an empty manifest", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([]);

    await expect(dispatchTransitManifest(ADMIN, MANIFEST_ID)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockedBulkUpdate).not.toHaveBeenCalled();
  });

  it("refuses a manifest that isn't open", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "received" }));

    await expect(dispatchTransitManifest(ADMIN, MANIFEST_ID)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("receiveTransitManifestParcels — the destination branch scans in", () => {
  it("hands every dispatched member to bulkUpdateParcelStatus as one arrived_at_branch batch", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "dispatched" }));
    // Two calls: membership-on-this-manifest, then liveMemberships' own lookup.
    mockedPrisma.transit_manifest_parcels.findMany
      .mockResolvedValueOnce([{ parcel_id: "p1" }])
      .mockResolvedValueOnce([]);
    mockedPrisma.parcels.findMany.mockResolvedValue([parcelRow({ id: "p1", status: "dispatched" })]);
    mockedBulkUpdate.mockResolvedValue({ updatedCount: 1, status: "arrived_at_branch" });

    const result = await receiveTransitManifestParcels(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] });

    expect(mockedBulkUpdate).toHaveBeenCalledWith(
      { id: ADMIN.id, roles: ADMIN.roles },
      { ids: ["p1"], status: "arrived_at_branch", transitManifestId: MANIFEST_ID },
    );
    expect(result.updated).toBe(1);
  });

  it("rejects a parcel still waiting at the origin hub (not dispatched yet)", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "dispatched" }));
    mockedPrisma.transit_manifest_parcels.findMany
      .mockResolvedValueOnce([{ parcel_id: "p1" }])
      .mockResolvedValueOnce([]);
    mockedPrisma.parcels.findMany.mockResolvedValue([parcelRow({ id: "p1", status: "oov" })]);

    await expect(
      receiveTransitManifestParcels(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("still waiting at the origin hub") });
    expect(mockedBulkUpdate).not.toHaveBeenCalled();
  });

  it("refuses to receive into a manifest that's still open", async () => {
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "open" }));

    await expect(
      receiveTransitManifestParcels(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

// A manifest whose origin and destination are the same branch can never be
// dispatched (bulkUpdateParcelStatus itself refuses that transition) and just
// sits open forever - reported live as "TRM-... Chitwan Branch → Chitwan
// Branch" for a parcel that was already sitting at the branch it was staged
// against.
describe("stageOrdersToBranch — the branch picker never creates a same-hub manifest", () => {
  it("rejects a parcel that's already at the chosen branch instead of routing it nowhere", async () => {
    mockedPrisma.locations.findFirst.mockResolvedValue({ id: HUB_ID, name: "Pokhara" });
    mockedPrisma.parcels.findMany.mockResolvedValue([
      parcelRow({ current_location_id: HUB_ID, destination_location_id: HUB_ID }),
    ]);

    await expect(
      stageOrdersToBranch(ADMIN, { parcelIds: ["parcel-1"], toBranchId: HUB_ID }),
    ).rejects.toMatchObject({ message: expect.stringContaining("Already at Pokhara - nothing to transit") });
    expect(mockedPrisma.transit_manifests.create).not.toHaveBeenCalled();
  });

  it("still stages a parcel genuinely elsewhere, bound for the branch", async () => {
    mockedPrisma.locations.findFirst.mockResolvedValue({ id: HUB_ID, name: "Pokhara" });
    mockedPrisma.parcels.findMany.mockResolvedValue([
      parcelRow({ current_location_id: "hub-kathmandu", destination_location_id: HUB_ID }),
    ]);
    mockedPrisma.locations.findMany.mockResolvedValue([{ id: "hub-kathmandu", name: "Kathmandu" }]);
    mockedPrisma.transit_manifests.findFirst.mockResolvedValue(null);
    mockedPrisma.transit_manifests.create.mockResolvedValue({ id: MANIFEST_ID });
    // Two different lookups share this mock: generateUniqueManifestNo's
    // clash-check (by manifest_no, wants a miss) and the trailing
    // getTransitManifestById (by id, wants a hit).
    mockedPrisma.transit_manifests.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.manifest_no ? null : manifestRow()),
    );
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValue([]);

    const result = await stageOrdersToBranch(ADMIN, { parcelIds: ["parcel-1"], toBranchId: HUB_ID });

    expect(result.added).toBe(1);
    expect(mockedPrisma.transit_manifests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ from_location_id: "hub-kathmandu", to_location_id: HUB_ID }),
      }),
    );
  });
});

describe("end to end: scan → dispatch → receive", () => {
  it("carries one parcel through the whole hand-over without ever touching status itself", async () => {
    // transit_manifests.findUnique is called twice per operation (the initial
    // load, then again inside the trailing getTransitManifestById) - a plain
    // mockResolvedValue covers both consistently within a step.
    // Step 1 - scan onto an open manifest: stages, parcel stays oov.
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany
      .mockResolvedValueOnce([]) // alreadyLinked
      .mockResolvedValueOnce([]); // liveMemberships
    mockedPrisma.parcels.findMany.mockResolvedValueOnce([parcelRow()]);
    const staged = await addParcelsToTransitManifest(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] });
    expect(staged.added).toBe(1);
    expect(mockedBulkUpdate).not.toHaveBeenCalled();

    // Step 2 - Dispatch: every staged (still oov) member moves in one batch.
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow());
    mockedPrisma.transit_manifest_parcels.findMany.mockResolvedValueOnce([
      { parcels: parcelRow() },
    ]);
    mockedBulkUpdate.mockResolvedValueOnce({ updatedCount: 1, status: "dispatched" });
    const dispatched = await dispatchTransitManifest(ADMIN, MANIFEST_ID);
    expect(dispatched.updated).toBe(1);
    expect(dispatched.skipped).toEqual([]);
    expect(mockedBulkUpdate).toHaveBeenLastCalledWith(
      { id: ADMIN.id, roles: ADMIN.roles },
      expect.objectContaining({ ids: ["parcel-1"], status: "dispatched", transitManifestId: MANIFEST_ID }),
    );

    // Step 3 - the destination branch scans it in: dispatched → arrived_at_branch.
    mockedPrisma.transit_manifests.findUnique.mockResolvedValue(manifestRow({ status: "dispatched" }));
    mockedPrisma.transit_manifest_parcels.findMany
      .mockResolvedValueOnce([{ parcel_id: "parcel-1" }]) // membership on this manifest
      .mockResolvedValueOnce([]); // liveMemberships
    mockedPrisma.parcels.findMany.mockResolvedValueOnce([parcelRow({ status: "dispatched" })]);
    mockedBulkUpdate.mockResolvedValueOnce({ updatedCount: 1, status: "arrived_at_branch" });
    const received = await receiveTransitManifestParcels(ADMIN, MANIFEST_ID, { trackingIds: ["TRK-1"] });
    expect(received.updated).toBe(1);
    expect(mockedBulkUpdate).toHaveBeenLastCalledWith(
      { id: ADMIN.id, roles: ADMIN.roles },
      { ids: ["parcel-1"], status: "arrived_at_branch", transitManifestId: MANIFEST_ID },
    );

    // transitManifest.service never writes parcels.status itself at any step -
    // bulkUpdateParcelStatus (and the manifest-row flip inside it) owns that.
    expect(mockedBulkUpdate).toHaveBeenCalledTimes(2);
  });
});
