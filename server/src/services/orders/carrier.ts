import type { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { handoffCarrier, HANDOFF_REMARK_PREFIX, UPAYA_HANDOFF_REMARK_PREFIX } from "../../utils/carrierRemark";

export const CARRIER_CODES = ["ncm", "upaya"] as const;
export type CarrierCode = (typeof CARRIER_CODES)[number];

export const isCarrierCode = (value: unknown): value is CarrierCode =>
  typeof value === "string" && (CARRIER_CODES as readonly string[]).includes(value);

/**
 * The 3PL that delivered a parcel, decided when its delivery is written:
 * a carrier placeholder rider ("PM Rider N/U") means that carrier, any real
 * rider means none, and no rider at all falls back to the carrier the parcel
 * was handed off to through the API.
 */
export async function resolveDeliveryCarrier(
  db: Prisma.TransactionClient | typeof prisma,
  parcelId: string,
  deliveryRiderId: string | null,
): Promise<CarrierCode | null> {
  if (deliveryRiderId) {
    const rider = await db.riders.findUnique({ where: { id: deliveryRiderId }, select: { carrier_code: true } });
    return isCarrierCode(rider?.carrier_code) ? rider.carrier_code : null;
  }
  const note = await db.parcel_remarks.findFirst({
    where: {
      parcel_id: parcelId,
      OR: [{ remark: { startsWith: HANDOFF_REMARK_PREFIX } }, { remark: { startsWith: UPAYA_HANDOFF_REMARK_PREFIX } }],
    },
    orderBy: { created_at: "desc" },
    select: { remark: true },
  });
  const carrier = handoffCarrier(note?.remark)?.toLowerCase();
  return isCarrierCode(carrier) ? carrier : null;
}
