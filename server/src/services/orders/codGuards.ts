import { parcel_status } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { DELIVERY_STATUSES } from "./status-shared";

/**
 * Whether this transition will (re)write the parcel's collected COD: a
 * delivery, or a partially delivered parcel heading back out for another
 * attempt (in-house via ready_to_deliver, or to a carrier via oov).
 */
export function writesCollection(from: parcel_status, to: parcel_status, hadPartial: boolean): boolean {
  if (from === to) return false;
  if (DELIVERY_STATUSES.includes(to)) return true;
  return hadPartial && (to === "ready_to_deliver" || to === "oov");
}

/**
 * Throws 409 when any of these parcels' COD is already on a settlement
 * statement (either leg, any status) or marked paid. Statement items and
 * remitted amounts are frozen copies of collected_amount, so a status change
 * that rewrites or voids that collection would leave the statement - or money
 * already paid out - disagreeing with the order behind it.
 */
export async function assertCodNotSettled(parcelIds: string[], action: string): Promise<void> {
  if (parcelIds.length === 0) return;
  const blocked = await prisma.cod_collections.findFirst({
    where: {
      parcel_id: { in: parcelIds },
      OR: [{ payment_status: "paid" }, { rider_payment_status: "paid" }, { settlement_items: { some: {} } }],
    },
    select: {
      parcels: { select: { tracking_id: true } },
      settlement_items: { select: { settlements: { select: { statement_id: true, payee_type: true } } }, take: 1 },
    },
  });
  if (!blocked) return;
  const stmt = blocked.settlement_items[0]?.settlements;
  const where = stmt ? `${stmt.payee_type} settlement ${stmt.statement_id}` : "a settled statement";
  throw new AppError(
    409,
    `Cannot ${action} ${blocked.parcels.tracking_id}: its COD is already in ${where}. Void or amend that statement first.`,
  );
}
