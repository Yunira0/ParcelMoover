import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "../../generated/prisma/client";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("../../lib/prisma", () => ({ default: { $transaction: transaction } }));
vi.mock("../../lib/branchScope", () => ({ assertHeadOfficeOnly: vi.fn() }));
// Posting has its own coverage in accounting.instalments.test.ts.
vi.mock("../accounting/sync", () => ({ syncCarrierSettlementPostings: vi.fn() }));
vi.mock("../payment-method.service", () => ({ getActivePaymentMethodNames: vi.fn() }));

import { updateCarrierSettlement } from "../carrier-settlement.service";

const staff = { id: "office-admin", roles: ["super_admin"] };

const statement = (overrides: Record<string, unknown> = {}) => ({
  id: "statement-1",
  statement_no: "CRS-1",
  carrier_code: "ncm",
  status: "pending",
  paid_amount: new Prisma.Decimal(0),
  gross_cod: new Prisma.Decimal(1_000),
  carrier_charges: new Prisma.Decimal(100),
  items: [{ cod_collection_id: "cod-1", carrier_charge: new Prisma.Decimal(100) }],
  ...overrides,
});

function stubTx(found: ReturnType<typeof statement>, collections: Array<{ id: string; collected: number }>) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: found.id }]),
    carrier_settlements: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(found),
      update: vi.fn(async () => ({ statement_no: found.statement_no })),
    },
    cod_collections: {
      findMany: vi.fn().mockResolvedValue(
        collections.map((c) => ({ id: c.id, collected_amount: new Prisma.Decimal(c.collected) })),
      ),
    },
    carrier_settlement_items: { deleteMany: vi.fn(), createMany: vi.fn() },
    audit_logs: { create: vi.fn() },
  };
  transaction.mockImplementation(async (callback: (t: unknown) => Promise<unknown>) => callback(tx));
  return tx;
}

beforeEach(() => vi.clearAllMocks());

describe("updateCarrierSettlement", () => {
  it("refuses once a payment has been recorded", async () => {
    const tx = stubTx(statement({ paid_amount: new Prisma.Decimal(50) }), []);

    await expect(
      updateCarrierSettlement(staff, "statement-1", { items: [{ codCollectionId: "cod-1", carrierCharge: 100 }] }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.carrier_settlement_items.deleteMany).not.toHaveBeenCalled();
  });

  it("replaces the orders and their charges, and recomputes the totals", async () => {
    const tx = stubTx(statement(), [{ id: "cod-1", collected: 1_000 }, { id: "cod-2", collected: 500 }]);

    const result = await updateCarrierSettlement(staff, "statement-1", {
      items: [{ codCollectionId: "cod-1", carrierCharge: 120 }, { codCollectionId: "cod-2", carrierCharge: 80 }],
    });

    expect(result).toMatchObject({ grossCod: 1_500, carrierCharges: 200, netReceivable: 1_300 });
    expect(tx.carrier_settlement_items.createMany).toHaveBeenCalledWith({
      data: [
        { cod_collection_id: "cod-1", collected_amount: 1_000, carrier_charge: 120, net_amount: 880, settlement_id: "statement-1" },
        { cod_collection_id: "cod-2", collected_amount: 500, carrier_charge: 80, net_amount: 420, settlement_id: "statement-1" },
      ],
    });
    // Its own orders stay eligible alongside unstatemented ones.
    expect(tx.cod_collections.findMany.mock.calls[0]![0].where.OR[1]).toEqual({
      carrier_settlement_item: { is: { settlement_id: "statement-1" } },
    });
  });

  it("rejects an order that is not eligible for this statement", async () => {
    const tx = stubTx(statement(), [{ id: "cod-1", collected: 1_000 }]);

    await expect(
      updateCarrierSettlement(staff, "statement-1", {
        items: [{ codCollectionId: "cod-1", carrierCharge: 100 }, { codCollectionId: "cod-9", carrierCharge: 100 }],
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.carrier_settlement_items.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a charge larger than the COD on that order", async () => {
    stubTx(statement(), [{ id: "cod-1", collected: 100 }]);

    await expect(
      updateCarrierSettlement(staff, "statement-1", { items: [{ codCollectionId: "cod-1", carrierCharge: 150 }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
