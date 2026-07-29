import { describe, it, expect } from "vitest";
import {
  publicCreateOrderSchema,
  publicOrderCodQuerySchema,
  publicReturnRequestSchema,
  publicSettlementsQuerySchema,
  publicUpdateOrderSchema,
} from "../publicApi.schema";

const baseReceiver = { name: "Jane Doe", phone: "9800000000" };

// Smallest payload the public create schema accepts: a destination, a street
// address for the default home_delivery, and explicit COD + weight.
const baseOrder = {
  receiver: { ...baseReceiver, address: "Baneshwor, Kathmandu" },
  destinationLocationId: "KATHMANDU",
  codAmount: 0,
  weightKg: 1,
};

describe("publicCreateOrderSchema", () => {
  it("accepts orderType: exchange (the Partner API create-order path already supports it)", () => {
    const result = publicCreateOrderSchema.safeParse({
      ...baseOrder,
      orderType: "exchange",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.orderType).toBe("exchange");
  });

  it("accepts allowPartialDelivery as a boolean flag", () => {
    const result = publicCreateOrderSchema.safeParse({
      ...baseOrder,
      allowPartialDelivery: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.allowPartialDelivery).toBe(true);
  });

  // A missing destination used to book the order at a delivery_charge of 0,
  // because createOrder skips rate quoting when it can't resolve one.
  it("rejects an order with no destination at all", () => {
    const { destinationLocationId, ...noDestination } = baseOrder;
    const result = publicCreateOrderSchema.safeParse(noDestination);
    expect(result.success).toBe(false);
  });

  it("accepts receiver.locationId as the destination instead of destinationLocationId", () => {
    const { destinationLocationId, ...rest } = baseOrder;
    const result = publicCreateOrderSchema.safeParse({
      ...rest,
      receiver: { ...rest.receiver, locationId: "POKHARA" },
    });
    expect(result.success).toBe(true);
  });

  it("requires receiver.address for home_delivery but not for branch_delivery", () => {
    const { address, ...receiverNoAddress } = baseOrder.receiver;

    expect(
      publicCreateOrderSchema.safeParse({ ...baseOrder, receiver: receiverNoAddress }).success,
    ).toBe(false);

    expect(
      publicCreateOrderSchema.safeParse({
        ...baseOrder,
        receiver: receiverNoAddress,
        serviceType: "branch_delivery",
      }).success,
    ).toBe(true);
  });

  it("requires codAmount and weightKg to be sent explicitly", () => {
    const { codAmount, ...noCod } = baseOrder;
    expect(publicCreateOrderSchema.safeParse(noCod).success).toBe(false);

    const { weightKg, ...noWeight } = baseOrder;
    expect(publicCreateOrderSchema.safeParse(noWeight).success).toBe(false);

    // 0 is a valid COD (prepaid) - only *absent* is rejected.
    expect(publicCreateOrderSchema.safeParse({ ...baseOrder, codAmount: 0 }).success).toBe(true);
    expect(publicCreateOrderSchema.safeParse({ ...baseOrder, weightKg: 0 }).success).toBe(false);
  });
});

describe("publicUpdateOrderSchema", () => {
  it("rejects an empty body (inherits the 'at least one field' refine)", () => {
    const result = publicUpdateOrderSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a hub name (not just a UUID) for destinationLocationId and receiver.locationId", () => {
    const result = publicUpdateOrderSchema.safeParse({
      destinationLocationId: "POKHARA",
      receiver: { ...baseReceiver, locationId: "KATHMANDU" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a pre-dispatch field edit without touching receiver", () => {
    const result = publicUpdateOrderSchema.safeParse({ codAmount: 1500 });
    expect(result.success).toBe(true);
  });
});

describe("publicReturnRequestSchema", () => {
  it("requires a reason of at least 3 characters", () => {
    expect(publicReturnRequestSchema.safeParse({ reason: "ok" }).success).toBe(false);
    expect(publicReturnRequestSchema.safeParse({ reason: "wrong item" }).success).toBe(true);
  });

  it("accepts optional notes", () => {
    const result = publicReturnRequestSchema.safeParse({
      reason: "Customer refused package",
      notes: "Left at the door, customer unreachable",
    });
    expect(result.success).toBe(true);
  });
});

describe("publicOrderCodQuerySchema / publicSettlementsQuerySchema", () => {
  it("only allows settled/not_settled as an order-cod status filter", () => {
    expect(publicOrderCodQuerySchema.safeParse({ status: "settled" }).success).toBe(true);
    expect(publicOrderCodQuerySchema.safeParse({ status: "paid" }).success).toBe(false);
  });

  it("requires settlement date filters to be ISO-8601 datetimes", () => {
    expect(
      publicSettlementsQuerySchema.safeParse({ fromDate: "2026-01-01T00:00:00Z" }).success,
    ).toBe(true);
    expect(publicSettlementsQuerySchema.safeParse({ fromDate: "2026-01-01" }).success).toBe(false);
  });
});
