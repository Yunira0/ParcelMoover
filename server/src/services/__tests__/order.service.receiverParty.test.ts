import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({ default: {} }));
vi.mock("../../lib/redis", () => ({
  default: { set: vi.fn(), del: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));

import { findOrCreateReceiver } from "../orders/create";

function makeTx() {
  return {
    parties: {
      findFirst: vi.fn(),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "new-party", ...data })),
      update: vi.fn(),
    },
  };
}

const receiver = {
  name: "Ram Sharma",
  phone: "98000 00001",
  alternatePhone: "",
  address: "Baneshwor, Kathmandu",
};

describe("findOrCreateReceiver", () => {
  let tx: ReturnType<typeof makeTx>;
  beforeEach(() => {
    tx = makeTx();
  });

  it("reuses a receiver only when every detail matches", async () => {
    const existing = { id: "party-1", name: "Ram Sharma", phone: "9800000001", address: "Baneshwor, Kathmandu" };
    tx.parties.findFirst.mockResolvedValue(existing);

    const result = await findOrCreateReceiver(tx as any, receiver);

    expect(result).toBe(existing);
    expect(tx.parties.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phone: "9800000001",
          name: "Ram Sharma",
          alternate_phone: null,
          address: "Baneshwor, Kathmandu",
        },
      }),
    );
    expect(tx.parties.create).not.toHaveBeenCalled();
  });

  // A copied order with the same phone but an edited name/address must carry
  // the edited details, without rewriting the receiver on earlier orders.
  it("creates a new receiver when the phone matches but the details were changed", async () => {
    tx.parties.findFirst.mockResolvedValue(null);

    const result = await findOrCreateReceiver(tx as any, { ...receiver, name: "Sita Sharma", address: "Lalitpur" });

    expect(tx.parties.update).not.toHaveBeenCalled();
    expect(tx.parties.create).toHaveBeenCalledWith({
      data: {
        name: "Sita Sharma",
        phone: "9800000001",
        alternate_phone: null,
        email: null,
        address: "Lalitpur",
      },
    });
    expect(result).toMatchObject({ id: "new-party", name: "Sita Sharma", address: "Lalitpur" });
  });
});
