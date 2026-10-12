import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

export interface BankDto {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

const toDto = (b: { id: string; name: string; code: string; is_active: boolean }): BankDto => ({
  id: b.id,
  name: b.name,
  code: b.code,
  isActive: b.is_active,
});

// Every bank, disabled ones included: a vendor saved with a bank that has since
// been disabled still needs its code. Pickers filter on isActive themselves.
export async function listBanks(): Promise<BankDto[]> {
  const rows = await prisma.banks.findMany({ orderBy: { name: "asc" } });
  return rows.map(toDto);
}

export async function createBank(input: { name: string; code: string }): Promise<BankDto> {
  // Case-insensitive, so a retyped name can't become a second copy of a bank.
  const existing = await prisma.banks.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
  });
  if (existing) throw new AppError(409, "A bank with this name already exists");

  return toDto(await prisma.banks.create({ data: { name: input.name, code: input.code } }));
}

// The name is deliberately not editable: vendors store it as their bank_name,
// so a rename would orphan them. To replace a bank, disable it and add the new one.
export async function updateBank(id: string, input: { code?: string; isActive?: boolean }): Promise<BankDto> {
  const existing = await prisma.banks.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Bank not found");

  const updated = await prisma.banks.update({
    where: { id },
    data: {
      ...(input.code !== undefined && { code: input.code }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
    },
  });
  return toDto(updated);
}
