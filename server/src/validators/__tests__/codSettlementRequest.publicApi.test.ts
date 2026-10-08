import { describe, expect, it } from "vitest";
import { publicCreateCodSettlementRequestSchema } from "../publicApi.schema";
import { listCodSettlementRequestsQuerySchema } from "../codSettlementRequest.schema";
import { buildOpenApiDocument } from "../../lib/openapi";

describe("Partner COD settlement request contract", () => {
  it("accepts a note but strips caller-supplied payout bank details", () => {
    const result = publicCreateCodSettlementRequestSchema.parse({
      note: "  Please pay this week  ",
      bankName: "Attacker Bank",
      accountNumber: "000000",
      accountName: "Other person",
    });
    expect(result).toEqual({ note: "Please pay this week" });
    expect(publicCreateCodSettlementRequestSchema.safeParse({ note: "x".repeat(1001) }).success).toBe(false);
  });

  it("validates request history filters", () => {
    expect(listCodSettlementRequestsQuerySchema.safeParse({ status: "rejected", page: "2" }).success).toBe(true);
    expect(listCodSettlementRequestsQuerySchema.safeParse({ status: "paid" }).success).toBe(false);
  });

  it("publishes all four operations in the generated API specification", () => {
    const spec = buildOpenApiDocument("https://example.test");
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths["/cod-settlement-requests"]?.get).toBeDefined();
    expect(paths["/cod-settlement-requests"]?.post).toBeDefined();
    expect(paths["/cod-settlement-requests/registered-bank"]?.get).toBeDefined();
    expect(paths["/cod-settlement-requests/{id}"]?.get).toBeDefined();
  });
});
