import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/order.service", () => ({
  createOrder: vi.fn(),
  getOrderByTrackingId: vi.fn(),
  getOrderStatusesByTrackingIds: vi.fn(),
  getSenderProfile: vi.fn(),
  listOrders: vi.fn(),
  updateOrderDetails: vi.fn(),
  updateParcelStatus: vi.fn(),
}));
vi.mock("../../../services/delivery-rate.service", () => ({ resolveDestinationRef: vi.fn() }));
vi.mock("../../../services/idempotency.service", () => ({
  withIdempotency: vi.fn(async (_key: string, _payload: unknown, fn: () => Promise<any>) => (await fn()).result),
}));
vi.mock("../../../utils/trackingId", () => ({ isValidTrackingId: vi.fn(() => true) }));

import { publicCancelOrderController, publicCreateOrderController } from "../orders.controller";
import { createOrder, getOrderByTrackingId, updateParcelStatus } from "../../../services/order.service";
import { withIdempotency } from "../../../services/idempotency.service";

const clientKey = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const vendorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const vendorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function request(vendorId: string, trackingId?: string) {
  return {
    apiKey: { id: "key-1", vendorId, userId: vendorId },
    headers: { "idempotency-key": clientKey },
    body: trackingId ? {} : { sender: { name: "Store", phone: "9800000000" } },
    params: trackingId ? { trackingId } : {},
  } as any;
}

function response() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("Partner order idempotency keys", () => {
  it("scopes order creation to the API key's vendor", async () => {
    vi.mocked(createOrder).mockResolvedValue({
      id: "order-1",
      tracking_id: "PM-ONE",
      status: "pickup_ordered",
      created_at: new Date(),
      delivery_charge: 100,
      gross_delivery_charge: 100,
      discount_amount: 0,
    } as any);

    await publicCreateOrderController(request(vendorA), response());
    await publicCreateOrderController(request(vendorB), response());

    expect(vi.mocked(withIdempotency).mock.calls.map(call => call[0])).toEqual([
      `partner-api:v1:${vendorA}:order-create:-:${clientKey}`,
      `partner-api:v1:${vendorB}:order-create:-:${clientKey}`,
    ]);
    expect(vi.mocked(withIdempotency).mock.calls[0]?.[3]).toEqual({ legacyKey: clientKey });
  });

  it("scopes cancellation to its order as well as the vendor", async () => {
    vi.mocked(getOrderByTrackingId).mockResolvedValue({ id: "order-1" } as any);
    vi.mocked(updateParcelStatus).mockResolvedValue({ status: "cancelled" } as any);

    await publicCancelOrderController(request(vendorA, "PM-ONE"), response());
    await publicCancelOrderController(request(vendorA, "PM-TWO"), response());

    expect(vi.mocked(withIdempotency).mock.calls.map(call => call[0])).toEqual([
      `partner-api:v1:${vendorA}:order-cancel:PM-ONE:${clientKey}`,
      `partner-api:v1:${vendorA}:order-cancel:PM-TWO:${clientKey}`,
    ]);
  });
});
