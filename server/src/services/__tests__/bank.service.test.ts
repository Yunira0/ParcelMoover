import { describe, it, expect, vi, beforeEach } from "vitest";

const { banks } = vi.hoisted(() => ({
  banks: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock("../../lib/prisma", () => ({ default: { banks } }));

import { createBank, listBanks, updateBank } from "../bank.service";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "bank-1",
  name: "Nabil Bank Ltd.",
  code: "0401",
  is_active: true,
  ...overrides,
});

describe("bank service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every bank, disabled ones included, with camelCase fields", async () => {
    banks.findMany.mockResolvedValue([row(), row({ id: "bank-2", is_active: false })]);

    const result = await listBanks();

    expect(result.map((b) => b.isActive)).toEqual([true, false]);
  });

  it("refuses to add a bank whose name already exists", async () => {
    banks.findFirst.mockResolvedValue(row());

    await expect(createBank({ name: "nabil bank ltd.", code: "0401" })).rejects.toMatchObject({ statusCode: 409 });
    expect(banks.create).not.toHaveBeenCalled();
  });

  it("adds a new bank", async () => {
    banks.findFirst.mockResolvedValue(null);
    banks.create.mockResolvedValue(row({ name: "Test Bank", code: "9999" }));

    const result = await createBank({ name: "Test Bank", code: "9999" });

    expect(banks.create).toHaveBeenCalledWith({ data: { name: "Test Bank", code: "9999" } });
    expect(result).toMatchObject({ name: "Test Bank", code: "9999", isActive: true });
  });

  it("changes only the fields it is given", async () => {
    banks.findUnique.mockResolvedValue(row());
    banks.update.mockResolvedValue(row({ is_active: false }));

    await updateBank("bank-1", { isActive: false });

    expect(banks.update).toHaveBeenCalledWith({ where: { id: "bank-1" }, data: { is_active: false } });
  });

  it("404s on a bank that does not exist", async () => {
    banks.findUnique.mockResolvedValue(null);

    await expect(updateBank("missing", { code: "1" })).rejects.toMatchObject({ statusCode: 404 });
  });
});
