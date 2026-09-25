import { Prisma } from "../../generated/prisma/client";
import { AppError } from "../../utils/AppError";
import { generateTrackingId } from "../../utils/trackingId";
import { generateDispatchNo } from "../../utils/dispatchId";
import { generateRunSheetNo } from "../../utils/runSheetNo";

const MAX_TRACKING_ID_RETRIES = 5;

type Party = { name: string; phone: string; alternate_phone?: string | null };
export function buildSearchText(trackingId: string, sender: Party, receiver: Party): string {
  return [
    trackingId,
    sender.name, sender.phone, sender.alternate_phone ?? "",
    receiver.name, receiver.phone, receiver.alternate_phone ?? "",
  ].join(" ").toLowerCase();
}

export async function generateUniqueTrackingId(
  tx: Prisma.TransactionClient,
  retries = 0,
): Promise<string> {
  const trackingId = generateTrackingId();

  // FIX: database schema uses tracking_id
  const existing = await tx.parcels.findUnique({
    where: { tracking_id: trackingId },
    select: { id: true },
  });

  if (!existing) {
    return trackingId;
  }

  if (retries >= MAX_TRACKING_ID_RETRIES) {
    throw new AppError(500, "Failed to generate unique tracking ID");
  }

  return generateUniqueTrackingId(tx, retries + 1);
}

export async function generateUniqueDispatchNo(
  tx: Prisma.TransactionClient,
  retries = 0,
): Promise<string> {
  const dispatchNo = generateDispatchNo();

  const existing = await tx.dispatches.findUnique({
    where: { dispatch_no: dispatchNo },
    select: { id: true },
  });

  if (!existing) {
    return dispatchNo;
  }

  if (retries >= MAX_TRACKING_ID_RETRIES) {
    throw new AppError(500, "Failed to generate unique dispatch number");
  }

  return generateUniqueDispatchNo(tx, retries + 1);
}

export async function generateUniqueRunSheetNo(
  tx: Prisma.TransactionClient,
  retries = 0,
): Promise<string> {
  const sheetNo = generateRunSheetNo();

  const existing = await tx.run_sheets.findUnique({
    where: { sheet_no: sheetNo },
    select: { id: true },
  });

  if (!existing) {
    return sheetNo;
  }

  if (retries >= MAX_TRACKING_ID_RETRIES) {
    throw new AppError(500, "Failed to generate unique run sheet number");
  }

  return generateUniqueRunSheetNo(tx, retries + 1);
}

// One run sheet per hand-off: opened whenever parcels transition to
// sent_for_delivery with a rider. The sheet freezes what the rider took;
// delivered/failed progress is later read off the member parcels.
export async function createRunSheet(
  tx: Prisma.TransactionClient,
  riderId: string,
  parcelIds: string[],
  createdBy: string,
) {
  const sheetNo = await generateUniqueRunSheetNo(tx);
  const sheet = await tx.run_sheets.create({
    data: {
      sheet_no: sheetNo,
      rider_id: riderId,
      created_by: createdBy,
    },
  });
  await tx.run_sheet_parcels.createMany({
    data: parcelIds.map((parcelId) => ({ run_sheet_id: sheet.id, parcel_id: parcelId })),
  });
  return sheet;
}

