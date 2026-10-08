import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn() } }));
import redis from "../../lib/redis";
import { assertNotDuplicateBatch, bulkBatchKey, rememberBulkBatch } from "../orders/bulkDuplicate";
import { publicBulkCreateOrderSchema } from "../../validators/publicApi.schema";

const row = { sender: { name: "Shop", phone: "9800000000" }, receiver: { name: "Customer", phone: "9810000000", address: "Street" }, destinationLocationId: "Kathmandu", codAmount: 100, weightKg: 1 };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(redis.get).mockResolvedValue(null); });

describe("duplicate bulk import warning", () => {
  it("matches reordered rows, but distinguishes another vendor and edited amounts", () => {
    const other = { ...row, codAmount: 200 };
    expect(bulkBatchKey("vendor-a", [row, other])).toBe(bulkBatchKey("vendor-a", [other, row]));
    expect(bulkBatchKey("vendor-a", [row])).not.toBe(bulkBatchKey("vendor-b", [row]));
    expect(bulkBatchKey("vendor-a", [row])).not.toBe(bulkBatchKey("vendor-a", [other]));
    expect(bulkBatchKey("staff", [{ ...row, vendorId: "a" }])).not.toBe(bulkBatchKey("staff", [{ ...row, vendorId: "b" }]));
  });
  it("rejects a recent completed batch with a machine-readable code, and permits explicit confirmation", async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ created: 2, createdAt: Date.now() }));
    await expect(assertNotDuplicateBatch("batch", false)).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_BATCH" });
    await expect(assertNotDuplicateBatch("batch", true)).resolves.toBeUndefined();
    expect(redis.get).toHaveBeenCalledTimes(1);
  });
  it("keeps the warning optional when Redis or its cache payload fails", async () => {
    vi.mocked(redis.get).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("bad JSON");
    await expect(assertNotDuplicateBatch("batch", false)).resolves.toBeUndefined();
    await expect(assertNotDuplicateBatch("batch", false)).resolves.toBeUndefined();
    vi.mocked(redis.setex).mockRejectedValue(new Error("offline"));
    await expect(rememberBulkBatch("batch", 2)).resolves.toBeUndefined();
  });
  it("records only successful imports for one hour", async () => {
    await rememberBulkBatch("batch", 0);
    expect(redis.setex).not.toHaveBeenCalled();
    await rememberBulkBatch("batch", 2);
    expect(redis.setex).toHaveBeenCalledWith("batch", 3600, expect.any(String));
  });
  it("validates each public row, strips staff overrides and requires a real confirmation boolean", () => {
    const parsed = publicBulkCreateOrderSchema.parse({ orders: [{ ...row, vendorId: "other-vendor", deliveryCharge: 0 }], confirmDuplicateBatch: true });
    expect(parsed.orders[0]).not.toHaveProperty("vendorId");
    expect(parsed.orders[0]).not.toHaveProperty("deliveryCharge");
    expect(publicBulkCreateOrderSchema.safeParse({ orders: [row], confirmDuplicateBatch: "true" }).success).toBe(false);
    expect(publicBulkCreateOrderSchema.safeParse({ orders: [{ ...row, destinationLocationId: undefined }] }).success).toBe(false);
    expect(publicBulkCreateOrderSchema.safeParse({ orders: Array.from({ length: 101 }, () => row) }).success).toBe(false);
  });
});
