import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    webhook_endpoints: { findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    webhook_deliveries: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/webhookCrypto", () => ({
  decryptSecret: vi.fn().mockReturnValue("whsec_test"),
  signPayload: vi.fn().mockReturnValue("t=1,v1=deadbeef"),
}));
vi.mock("../../lib/mailer", () => ({
  sendWebhookDisabledEmail: vi.fn().mockResolvedValue(undefined),
}));

import { emitWebhookEvent, runDeliverySweep } from "../webhookDispatch.service";
import prisma from "../../lib/prisma";
import { sendWebhookDisabledEmail } from "../../lib/mailer";

const mockedPrisma = prisma as unknown as {
  webhook_endpoints: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  webhook_deliveries: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("emitWebhookEvent", () => {
  it("uses the same id for the payload's `id` field and the delivery's event_id", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      webhook_endpoints: {
        findMany: vi.fn().mockResolvedValue([{ id: "ep-1", vendor_id: "vendor-1", event_types: [] }]),
      },
      webhook_deliveries: { createMany },
    } as any;

    await emitWebhookEvent(tx, "vendor-1", "order.status_changed", { trackingId: "PM1" });

    const row = createMany.mock.calls[0]![0].data[0];
    expect(row.event_id).toBe(row.payload.id);
  });
});

describe("runDeliverySweep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedPrisma.webhook_deliveries.findMany.mockReset();
    mockedPrisma.webhook_deliveries.update.mockReset();
    mockedPrisma.webhook_endpoints.update.mockReset();
    mockedPrisma.webhook_endpoints.findUnique.mockReset();
    mockedPrisma.$transaction.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips a sweep that starts while a previous one is still running", async () => {
    // A findMany that never resolves within this test keeps the first sweep
    // "in flight" for as long as the assertion needs it to be.
    let resolveFindMany: (v: unknown[]) => void;
    const pending = new Promise((resolve) => {
      resolveFindMany = resolve;
    });
    mockedPrisma.webhook_deliveries.findMany.mockReturnValue(pending);

    const first = runDeliverySweep();
    const second = await runDeliverySweep();

    expect(second).toEqual({ attempted: 0 });
    expect(mockedPrisma.webhook_deliveries.findMany).toHaveBeenCalledTimes(1);

    resolveFindMany!([]);
    await first;
  });

  it("sends a disable notification once an endpoint exhausts its 12th attempt", async () => {
    const delivery = {
      id: "d-1",
      event_type: "order.status_changed",
      event_id: "evt-1",
      payload: { id: "evt-1" },
      attempt_count: 11, // this failure is the 12th
      webhook_endpoint_id: "ep-1",
      webhook_endpoints: {
        id: "ep-1",
        url: "https://vendor.example/hook",
        secret_encrypted: "enc",
        consecutive_failures: 4, // one more push crosses CIRCUIT_BREAKER_THRESHOLD (5)
      },
    };
    mockedPrisma.webhook_deliveries.findMany.mockResolvedValue([delivery]);
    mockedPrisma.webhook_deliveries.update.mockResolvedValue({});
    mockedPrisma.webhook_endpoints.update
      .mockResolvedValueOnce({
        id: "ep-1",
        name: "Order sync",
        url: "https://vendor.example/hook",
        consecutive_failures: 5,
        disabled_at: null,
      })
      .mockResolvedValueOnce({});
    mockedPrisma.webhook_endpoints.findUnique.mockResolvedValue({
      vendors: { client_name: "Acme Store", email: "ops@acme.test", users: null },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await runDeliverySweep();

    expect(sendWebhookDisabledEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@acme.test",
        vendorName: "Acme Store",
        endpointName: "Order sync",
        endpointUrl: "https://vendor.example/hook",
      }),
    );
  });

  it("never lets a mailer failure escape the delivery sweep", async () => {
    const delivery = {
      id: "d-1",
      event_type: "order.status_changed",
      event_id: "evt-1",
      payload: { id: "evt-1" },
      attempt_count: 11,
      webhook_endpoint_id: "ep-1",
      webhook_endpoints: {
        id: "ep-1",
        url: "https://vendor.example/hook",
        secret_encrypted: "enc",
        consecutive_failures: 4,
      },
    };
    mockedPrisma.webhook_deliveries.findMany.mockResolvedValue([delivery]);
    mockedPrisma.webhook_deliveries.update.mockResolvedValue({});
    mockedPrisma.webhook_endpoints.update
      .mockResolvedValueOnce({
        id: "ep-1",
        name: "Order sync",
        url: "https://vendor.example/hook",
        consecutive_failures: 5,
        disabled_at: null,
      })
      .mockResolvedValueOnce({});
    mockedPrisma.webhook_endpoints.findUnique.mockRejectedValue(new Error("DB blip"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(runDeliverySweep()).resolves.toEqual({ attempted: 1 });
  });
});
