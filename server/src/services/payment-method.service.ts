import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { ensureMethodAccount } from "./accounting/accounts";

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

  // Backfills the ledger account for methods that predate them, so an existing
  // install starts routing per method without anyone having to run a script.
  //
  // Off the response path in both senses: not awaited, and throttled. This is a
  // read, and getActivePaymentMethodNames routes every settlement payment
  // through it - the caller is owed the list, not a chart-of-accounts repair.
  // Nothing in the DTO depends on the outcome, and a method with no account yet
  // still routes correctly by name (see cashAccountForMethod).
  backfillAccounts(rows);

  return rows.map(toDto);
}

// Active method names, used by the settlement payment flow to validate that a
// submitted payment.method is a currently-enabled method.
export async function getActivePaymentMethodNames(): Promise<string[]> {
  const rows = await listPaymentMethods({ activeOnly: true });
  return rows.map((r) => r.name);
}

/**
 * Gives each method a ledger account, quietly.
 *
 * Never allowed to break the payment-method screen: if the chart of accounts is
 * missing (a fresh install that has not run seed:accounting yet), the method
 * still saves and its payments route by name until the account catches up on a
 * later read.
 */
async function ensureAccounts(
  methods: { id: string; name: string; ledger_account_id: string | null }[],
): Promise<void> {
  for (const method of methods) {
    if (method.ledger_account_id) continue;
    try {
      await ensureMethodAccount(prisma, method);
    } catch (error) {
      console.error(`[Ledger] Could not create an account for payment method "${method.name}":`, error);
    }
  }
}

// How long to wait before trying the backfill again after a pass that left
// methods unaccounted for. The usual reason is a chart of accounts that has not
// been seeded yet, which no amount of retrying fixes - so retry slowly, and let
// the error land in the log once every few minutes rather than once per request.
const BACKFILL_RETRY_MS = 5 * 60 * 1000;
let backfillNotBefore = 0;

/** The read path's throttled, fire-and-forget wrapper around ensureAccounts. */
function backfillAccounts(
  methods: { id: string; name: string; is_active?: boolean; ledger_account_id: string | null }[],
): void {
  // Active methods only. A disabled method takes no more money, so minting an
  // account for it just adds an empty row to the chart - and for the ones that
  // were disabled *because* they were superseded, it would recreate the very
  // account that was retired.
  const pending = methods.filter((method) => !method.ledger_account_id && method.is_active !== false);
  if (pending.length === 0) return;
  if (Date.now() < backfillNotBefore) return;
  backfillNotBefore = Date.now() + BACKFILL_RETRY_MS;

  void ensureAccounts(pending).catch((error) => {
    console.error("[Ledger] Payment method account backfill failed:", error);
  });
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
      await ensureAccounts([reactivated]);
      return toDto(reactivated);
    }
    throw new AppError(409, "A payment method with this name already exists");
  }

  const max = await prisma.payment_methods.aggregate({ _max: { sort_order: true } });
  const created = await prisma.payment_methods.create({
    data: { name, sort_order: (max._max.sort_order ?? 0) + 1 },
  });

  // The account is created with the method, so the very first payment taken
  // through it lands somewhere carrying its own name rather than in a shared
  // bucket that reconciles against nobody's statement.
  await ensureAccounts([created]);

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
