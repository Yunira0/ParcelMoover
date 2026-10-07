import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/order.service", () => ({ createOrder: vi.fn() }));
vi.mock("../../services/idempotency.service", () => ({
  withIdempotency: vi.fn(async (_key: string, _payload: unknown, fn: () => Promise<any>) => (await fn()).result),
}));

import { createOrderController } from "../order.controller";
import { createOrder } from "../../services/order.service";
import { withIdempotency } from "../../services/idempotency.service";

const key = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const actorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function request(userId: string) {
  return {
    user: { id: userId, roles: ["vendor"] },
    headers: { "idempotency-key": key },
    body: { receiver: { name: "Customer" } },
  } as any;
}

function response() {
  const res: any = {
    statusCode: 0,
    status(code: number) { res.statusCode = code; return res; },
    json() { return res; },
  };
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("dashboard order idempotency isolation", () => {
  it("uses a distinct cache key for each authenticated vendor user", async () => {
    vi.mocked(createOrder).mockResolvedValue({
      id: "order-1",
      order_number: "O-1",
      tracking_id: "PM-ONE",
      status: "pickup_ordered",
      created_at: new Date(),
      delivery_charge: 100,
      gross_delivery_charge: 100,
      discount_amount: 0,
    } as any);

    await createOrderController(request(actorA), response());
    await createOrderController(request(actorB), response());

    expect(vi.mocked(withIdempotency).mock.calls.map(call => call[0])).toEqual([
      `dashboard:${actorA}:order-create:-:${key}`,
      `dashboard:${actorB}:order-create:-:${key}`,
    ]);
    expect(vi.mocked(withIdempotency).mock.calls[0]?.[3]).toEqual({ legacyKey: key });
  });
});
