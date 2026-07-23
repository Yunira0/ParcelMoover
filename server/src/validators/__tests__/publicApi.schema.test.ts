import { describe, it, expect } from "vitest";
import {
  publicCreateOrderSchema,
  publicOrderCodQuerySchema,
  publicReturnRequestSchema,
  publicSettlementsQuerySchema,
  publicUpdateOrderSchema,
} from "../publicApi.schema";

const baseReceiver = { name: "Jane Doe", phone: "9800000000" };

describe("publicCreateOrderSchema", () => {
  it("accepts orderType: exchange (the Partner API create-order path already supports it)", () => {
    const result = publicCreateOrderSchema.safeParse({
      receiver: baseReceiver,
      orderType: "exchange",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.orderType).toBe("exchange");
  });

  it("accepts allowPartialDelivery as a boolean flag", () => {
    const result = publicCreateOrderSchema.safeParse({
      receiver: baseReceiver,
      allowPartialDelivery: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.allowPartialDelivery).toBe(true);
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
