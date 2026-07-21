import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

// Methods seeded on first read so the table is never empty (mirrors the two
// values that used to be a hardcoded enum before this became configurable).
const DEFAULT_METHODS = ["Cash", "Online"];

export interface PaymentMethodDto {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

function toDto(m: {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}): PaymentMethodDto {
  return { id: m.id, name: m.name, isActive: m.is_active, sortOrder: m.sort_order };
}

export async function listPaymentMethods(opts?: { activeOnly?: boolean }): Promise<PaymentMethodDto[]> {
  const count = await prisma.payment_methods.count();
  if (count === 0) {
    await prisma.payment_methods.createMany({
      data: DEFAULT_METHODS.map((name, i) => ({ name, sort_order: i })),
      skipDuplicates: true,
    });
  }

  const rows = await prisma.payment_methods.findMany({
    ...(opts?.activeOnly ? { where: { is_active: true } } : {}),
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });
  return rows.map(toDto);
}

// Active method names, used by the settlement payment flow to validate that a
// submitted payment.method is a currently-enabled method.
export async function getActivePaymentMethodNames(): Promise<string[]> {
  const rows = await listPaymentMethods({ activeOnly: true });
  return rows.map((r) => r.name);
}

export async function createPaymentMethod(nameRaw: string): Promise<PaymentMethodDto> {
  const name = nameRaw.trim();
  if (!name) throw new AppError(400, "Payment method name is required");

  // Case-insensitive match so "esewa" and "eSewa" don't become two methods.
  const existing = await prisma.payment_methods.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    // Re-adding a previously disabled method just re-enables it rather than
    // erroring on the unique-name constraint.
    if (!existing.is_active) {
      const reactivated = await prisma.payment_methods.update({
        where: { id: existing.id },
        data: { is_active: true },
      });
      return toDto(reactivated);
    }
    throw new AppError(409, "A payment method with this name already exists");
  }

  const max = await prisma.payment_methods.aggregate({ _max: { sort_order: true } });
  const created = await prisma.payment_methods.create({
    data: { name, sort_order: (max._max.sort_order ?? 0) + 1 },
  });
  return toDto(created);
}

// Soft enable/disable - disabled methods drop out of the payment dropdown but
// remain on any historical settlement that referenced them.
export async function setPaymentMethodActive(id: string, isActive: boolean): Promise<PaymentMethodDto> {
  const existing = await prisma.payment_methods.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Payment method not found");

  const updated = await prisma.payment_methods.update({
    where: { id },
    data: { is_active: isActive },
  });
  return toDto(updated);
}
