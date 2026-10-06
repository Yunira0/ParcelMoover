import { beforeEach, describe, expect, it, vi } from "vitest";

const redisRows = vi.hoisted(() => new Map<string, string>());

vi.mock("../../lib/redis", () => ({
  default: {
    get: vi.fn(async (key: string) => redisRows.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      if (redisRows.has(key)) return null;
      redisRows.set(key, value);
      return "OK";
    }),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      redisRows.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => Number(redisRows.delete(key))),
  },
}));

import { withIdempotency } from "../idempotency.service";
import { partnerIdempotencyKey } from "../../controllers/publicApi/shared";

const clientKey = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const vendorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const vendorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reqFor = (vendorId: string) => ({ apiKey: { vendorId } }) as any;

function action(result: { vendorId: string }) {
  return async () => ({
    result,
    response: { statusCode: 201, body: result, resourceID: result.vendorId },
  });
}

beforeEach(() => redisRows.clear());

describe("Partner API idempotency isolation", () => {
  it("keeps the same client UUID separate by vendor, operation, and resource", async () => {
    const createA = partnerIdempotencyKey(reqFor(vendorA), "order-create", clientKey);
    const createB = partnerIdempotencyKey(reqFor(vendorB), "order-create", clientKey);
    const cancelA = partnerIdempotencyKey(reqFor(vendorA), "order-cancel", clientKey, "PM-ONE");
    const cancelOther = partnerIdempotencyKey(reqFor(vendorA), "order-cancel", clientKey, "PM-TWO");
    expect(new Set([createA, createB, cancelA, cancelOther]).size).toBe(4);

    const body = { note: "same payload" };
    expect(await withIdempotency(createA, body, action({ vendorId: vendorA }))).toEqual({ vendorId: vendorA });
    expect(await withIdempotency(createB, body, action({ vendorId: vendorB }))).toEqual({ vendorId: vendorB });

    const replayedAction = vi.fn(action({ vendorId: "wrong" }));
    expect(await withIdempotency(createA, body, replayedAction)).toEqual({ vendorId: vendorA });
    expect(replayedAction).not.toHaveBeenCalled();
  });

  it("rejects an old unscoped cache entry before a write can be repeated", async () => {
    redisRows.set(`idempotency:response:${clientKey}`, JSON.stringify({ body: { vendorId: vendorA } }));
    const freshAction = vi.fn(action({ vendorId: vendorB }));

    await expect(withIdempotency(
      partnerIdempotencyKey(reqFor(vendorB), "order-create", clientKey),
      { note: "same payload" },
      freshAction,
      { legacyKey: clientKey },
    )).rejects.toMatchObject({ statusCode: 409 });
    expect(freshAction).not.toHaveBeenCalled();
  });
});
