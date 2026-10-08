import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma", () => ({ default: {
  parcels: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  locations: { findMany: vi.fn() }, riders: { findMany: vi.fn() },
} }));
vi.mock("../../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn() }, scanAndDelete: vi.fn() }));
vi.mock("../scope", async (importOriginal) => ({
  ...await importOriginal<typeof import("../scope")>(), getActorScope: vi.fn(),
}));

import prisma from "../../../lib/prisma";
import redis from "../../../lib/redis";
import { getActorScope } from "../scope";
import { getOrderFilterOptions, listOrders } from "../query-core";

const actor = { id: "user-a", roles: ["vendor"] };
const scope = { vendorId: "vendor-a", vendorIds: undefined, riderId: undefined, branchLocationIds: undefined };
const date = new Date("2026-10-06T00:00:00Z");
function parcel() {
  return {
    id: "parcel-1", order_number: 42, tracking_id: "PM-42", status: "cancelled", order_type: "forward", service_type: "standard",
    parties_parcels_sender_idToparties: { name: "Shop", phone: "9800000001", address: "Origin street" },
    parties_parcels_receiver_idToparties: { name: "Customer", phone: "9800000002", alternate_phone: "9800000003", address: "Destination street" },
    locations_parcels_origin_location_idTolocations: { name: "Origin hub" },
    locations_parcels_destination_location_idTolocations: { name: "Destination hub", valley: true },
    vendors: { business_name: "Shop Ltd", client_name: "Shop", pickup_landmark: "Front door", label_width_mm: 80, label_height_mm: 60 },
    riders_parcels_delivery_rider_idToriders: { name: "Delivery rider" }, riders_parcels_pickup_rider_idToriders: { name: "Pickup rider" },
    parcel_remarks: [{ remark: "Call first" }],
    parcel_status_history: [{ created_at: date, old_status: "pickup_ordered", new_status: "cancelled", users: { full_name: "Internal name", user_roles: [{ roles: { code: "admin" } }] } }],
    cod_collections: { collected_amount: 400 }, origin_location_id: "hub-1", destination_location_id: "hub-2",
    pieces: 2, weight_kg: 1.5, attempt_count: 1, cod_amount: 500, item_value: 600, delivery_charge: 100, gross_delivery_charge: 120, discount_amount: 20,
    package_type: "Box", delivery_instruction: "Call first", vendor_id: "vendor-a", allow_partial_delivery: true,
    partial_delivery_remarks: null, partial_cod_collected: null, source_order_id: null, updated_at: date, created_at: date, delivered_at: null,
  } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActorScope).mockResolvedValue(scope);
  vi.mocked(redis.get).mockResolvedValue(null);
  vi.mocked(redis.setex).mockResolvedValue("OK");
  vi.mocked(prisma.parcels.count).mockResolvedValue(1);
  vi.mocked(prisma.parcels.findMany).mockResolvedValue([parcel()]);
  vi.mocked(prisma.parcels.groupBy).mockResolvedValue([]);
});

describe("SQL-grouped order filter options", () => {
  it("keeps same-name hubs distinct, includes every hub, handles nulls and deduplicates rider names", async () => {
    const origins = Array.from({ length: 205 }, (_, i) => ({ origin_location_id: `hub-${i}` }));
    vi.mocked(prisma.parcels.groupBy).mockImplementation((async ({ by }: any) => {
      if (by[0] === "origin_location_id") return [...origins, { origin_location_id: null }] as any;
      if (by[0] === "destination_location_id") return [{ destination_location_id: "hub-0" }, { destination_location_id: null }] as any;
      return [{ [by[0]]: by[0] === "delivery_rider_id" ? "rider-1" : "rider-2" }] as any;
    }) as any);
    vi.mocked(prisma.locations.findMany).mockResolvedValue(origins.map(row => ({ id: row.origin_location_id, name: "Same name" })) as any);
    vi.mocked(prisma.riders.findMany).mockResolvedValue([{ id: "rider-1", name: "Rider" }, { id: "rider-2", name: "Rider" }] as any);
    const result = await getOrderFilterOptions(actor, ["delivered"]);
    expect(result.origins).toHaveLength(205);
    expect(new Set(result.origins.map(row => row.id)).size).toBe(205);
    expect(result.destinations).toEqual([{ id: "hub-0", name: "Same name" }]);
    expect(result.riders).toEqual(["Rider"]);
    expect(prisma.parcels.findMany).not.toHaveBeenCalled();
    expect(prisma.locations.findMany).toHaveBeenCalledTimes(1);
    for (const [args] of vi.mocked(prisma.parcels.groupBy).mock.calls) {
      const serialized = JSON.stringify(args.where);
      expect(serialized).toContain('"vendor_id":"vendor-a"');
      expect(serialized).toContain('"deleted_at":null');
      expect(serialized).toContain('"status":{"in":["delivered"]}');
    }
  });
  it("does not load unrelated names when the scope has no matching parcels", async () => {
    expect(await getOrderFilterOptions(actor)).toEqual({ origins: [], destinations: [], riders: [] });
    expect(prisma.locations.findMany).not.toHaveBeenCalled();
    expect(prisma.riders.findMany).not.toHaveBeenCalled();
  });
});

describe("lean order reads", () => {
  it("preserves labels, finance fields, cancellation history and staff redaction", async () => {
    const result = await listOrders(actor, { page: 1, pageSize: 20 });
    expect(result.data[0]).toMatchObject({
      id: "parcel-1", orderNumber: 42, senderAddress: "Origin street", receiverAlternatePhone: "9800000003",
      destinationName: "Destination hub", destinationValley: true, vendorName: "Shop Ltd", vendorLocation: "Front door",
      labelWidthMm: 80, labelHeightMm: 60, collectedAmount: 400, grossDeliveryCharge: 120, discountAmount: 20,
      cancelledFromStatus: "pickup_ordered", remarks: "Call first", lastUpdatedBy: "Origin hub", lastUpdatedAt: date.toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain("Internal name");
    expect(result.meta).toMatchObject({ total: 1, totalPages: 1, page: 1, pageSize: 20 });
    const args = vi.mocked(prisma.parcels.findMany).mock.calls[0]![0]!;
    expect(args.include?.vendors).toEqual({ select: { business_name: true, client_name: true, pickup_landmark: true, label_width_mm: true, label_height_mm: true } });
    expect(args.include?.parcel_remarks).toMatchObject({ select: { remark: true }, take: 1 });
  });
  it("intersects an explicit foreign vendor filter with the authenticated vendor", async () => {
    await listOrders(actor, { page: 1, vendorId: ["vendor-b"] });
    const args = vi.mocked(prisma.parcels.findMany).mock.calls[0]![0]!;
    expect(args.where?.AND).toEqual(expect.arrayContaining([{ vendor_id: "vendor-a" }, { vendor_id: { in: ["vendor-b"] } }]));
  });
  it.each([{ dateFrom: "2026-10-01" }, { dateTo: "2026-10-06" }, { dateField: "lastUpdatedAt" as const }, { sortDir: "asc" as const }])("does not reuse or overwrite the default cache for %j", async query => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ data: [{ id: "wrong-cached-order" }] }));
    const result = await listOrders(actor, query);
    expect(result.data[0]?.id).toBe("parcel-1");
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });
  it("coalesces concurrent default-list misses and retries after a failed computation", async () => {
    let resolve!: (rows: any[]) => void;
    vi.mocked(prisma.parcels.findMany).mockImplementationOnce(() => new Promise<any[]>(done => { resolve = done; }) as any);
    const first = listOrders(actor);
    const second = listOrders(actor);
    await vi.waitFor(() => expect(prisma.parcels.findMany).toHaveBeenCalledTimes(1));
    resolve([parcel()]);
    expect(await first).toEqual(await second);
    expect(prisma.parcels.count).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);
    vi.mocked(prisma.parcels.findMany).mockRejectedValueOnce(new Error("temporary"));
    await expect(listOrders(actor)).rejects.toThrow("temporary");
    await expect(listOrders(actor)).resolves.toMatchObject({ data: [{ id: "parcel-1" }] });
  });
});
