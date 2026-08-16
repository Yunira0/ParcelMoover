import { describe, it, expect, vi, beforeEach } from "vitest";

// processUpayaWebhook's job is to classify Upaya's ~25 webhook status values
// into one of three verbs (forward carrier-leg status, one-way follow_up
// exit, or a logged/flagged parcel_remarks row) and never let an unreviewed
// webhook silently mutate parcel_status for the statuses that need a human
// (hold/loss-and-damage/cancelled) — see the classification tables in
// upaya.service.ts and docs/upaya-integration-plan.md.

vi.mock("../../lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
    parcel_remarks: { create: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("../order.service", () => ({
  applyExternalCarrierStatus: vi.fn().mockResolvedValue({ applied: true }),
  applyExternalCarrierFollowUp: vi.fn().mockResolvedValue({ applied: true }),
  invalidateOrderCaches: vi.fn(),
}));

import { processUpayaWebhook } from "../upaya.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { applyExternalCarrierFollowUp, applyExternalCarrierStatus } from "../order.service";

const mockedPrisma = prisma as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  parcel_remarks: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};
const mockedRedis = redis as unknown as { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
const mockedApplyStatus = applyExternalCarrierStatus as ReturnType<typeof vi.fn>;
const mockedApplyFollowUp = applyExternalCarrierFollowUp as ReturnType<typeof vi.fn>;

const PARCEL_ID = "parcel-1";
const TRACKING_ID = "PM-TEST-TRACKING";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    update_type: "order_status" as const,
    order_id: "5000",
    order_reference_id: TRACKING_ID,
    status: "received-at-hub",
    ...overrides,
  };
}

beforeEach(() => {
  mockedPrisma.$queryRaw.mockResolvedValue([{ id: PARCEL_ID }]);
  mockedRedis.get.mockResolvedValue(null);
  mockedRedis.set.mockResolvedValue("OK");
  mockedPrisma.parcel_remarks.create.mockResolvedValue({});
});

describe("processUpayaWebhook — parcel resolution", () => {
  it("resolves the parcel via order_reference_id (tracking_id, hyphens stripped) first", async () => {
    await processUpayaWebhook(payload());
    expect(mockedPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockedApplyStatus).toHaveBeenCalledWith(PARCEL_ID, "arrived_at_branch", expect.any(String));
  });

  it("falls back to the Redis order-id cache when order_reference_id doesn't resolve", async () => {
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedRedis.get.mockResolvedValue(PARCEL_ID);
    await processUpayaWebhook(payload({ order_reference_id: undefined }));
    expect(mockedApplyStatus).toHaveBeenCalledWith(PARCEL_ID, "arrived_at_branch", expect.any(String));
  });

  it("no-ops when the parcel can't be resolved at all", async () => {
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedRedis.get.mockResolvedValue(null);
    await processUpayaWebhook(payload());
    expect(mockedApplyStatus).not.toHaveBeenCalled();
    expect(mockedApplyFollowUp).not.toHaveBeenCalled();
  });

  it("no-ops when neither order_id nor order_reference_id is present", async () => {
    await processUpayaWebhook(payload({ order_id: undefined, order_reference_id: undefined }));
    expect(mockedPrisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("processUpayaWebhook — forward carrier-leg statuses", () => {
  it.each([
    ["unassigned-pickup", "dispatched"],
    ["picked-up-by-rider", "dispatched"],
    ["received-at-hub", "arrived_at_branch"],
    ["ready-for-dispatch", "arrived_at_branch"],
    ["dispatched-with-rider", "sent_for_delivery"],
    ["delivered", "delivered"],
  ])("maps '%s' -> applyExternalCarrierStatus(%s)", async (status, target) => {
    await processUpayaWebhook(payload({ status }));
    expect(mockedApplyStatus).toHaveBeenCalledWith(PARCEL_ID, target, expect.stringContaining(`Upaya: ${status}`));
    expect(mockedApplyFollowUp).not.toHaveBeenCalled();
  });
});

describe("processUpayaWebhook — one-way follow_up exit", () => {
  it.each(["on-field-failed-delivery", "followup-for-return"])(
    "'%s' calls applyExternalCarrierFollowUp, not applyExternalCarrierStatus",
    async (status) => {
      await processUpayaWebhook(payload({ status }));
      expect(mockedApplyFollowUp).toHaveBeenCalledWith(PARCEL_ID, expect.stringContaining(`Upaya: ${status}`));
      expect(mockedApplyStatus).not.toHaveBeenCalled();
    },
  );
});

describe("processUpayaWebhook — review-flagged statuses (never auto-applied)", () => {
  it.each(["hold", "loss-and-damage", "cancelled"])(
    "'%s' writes an open (pending) parcel_remarks row instead of mutating parcel_status",
    async (status) => {
      await processUpayaWebhook(payload({ status }));
      expect(mockedApplyStatus).not.toHaveBeenCalled();
      expect(mockedApplyFollowUp).not.toHaveBeenCalled();
      expect(mockedPrisma.parcel_remarks.create).toHaveBeenCalledTimes(1);
      const call = mockedPrisma.parcel_remarks.create.mock.calls[0]![0];
      expect(call.data.parcel_id).toBe(PARCEL_ID);
      expect(call.data.remark).toContain("needs review");
      // No workflow_status key => DB default ("pending"), which keeps it in
      // the ops remarks queue - explicitly NOT "closed".
      expect(call.data.workflow_status).toBeUndefined();
    },
  );
});

describe("processUpayaWebhook — logged-only statuses (informational, no review needed)", () => {
  it.each([
    "confirmed-for-return",
    "out-for-return",
    "return-processed-from-hub",
    "return-received-at-central-facility",
    "on-field-failed-return",
    "returned-to-vendor",
    "redirected",
    "dispose",
  ])("'%s' writes a closed parcel_remarks row and doesn't touch parcel_status", async (status) => {
    await processUpayaWebhook(payload({ status }));
    expect(mockedApplyStatus).not.toHaveBeenCalled();
    expect(mockedApplyFollowUp).not.toHaveBeenCalled();
    expect(mockedPrisma.parcel_remarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workflow_status: "closed" }) }),
    );
  });
});

describe("processUpayaWebhook — comments", () => {
  it("writes an inbound comment as a parcel_remarks row", async () => {
    await processUpayaWebhook({
      update_type: "comment",
      order_id: "5000",
      order_reference_id: TRACKING_ID,
      comment: "Customer not available",
      commented_by: "rider_001",
    });
    expect(mockedPrisma.parcel_remarks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parcel_id: PARCEL_ID,
          remark: expect.stringContaining("Customer not available"),
        }),
      }),
    );
    expect(mockedApplyStatus).not.toHaveBeenCalled();
  });

  it("no-ops a comment payload with no comment text", async () => {
    await processUpayaWebhook({
      update_type: "comment",
      order_id: "5000",
      order_reference_id: TRACKING_ID,
    });
    expect(mockedPrisma.parcel_remarks.create).not.toHaveBeenCalled();
  });
});

describe("processUpayaWebhook — unrecognized status", () => {
  it("does nothing for a status outside the known vocabulary", async () => {
    await processUpayaWebhook(payload({ status: "totally-unknown-status" }));
    expect(mockedApplyStatus).not.toHaveBeenCalled();
    expect(mockedApplyFollowUp).not.toHaveBeenCalled();
    expect(mockedPrisma.parcel_remarks.create).not.toHaveBeenCalled();
  });
});
