import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

// Vendor-configurable sticker/label print size.
//
// Printed labels were hardcoded to 100mm x 75mm (see printLabels.ts on the
// client), but vendors run their own thermal sticker printers loaded with
// whatever label stock they actually have - anyone not on 100x75mm got a
// mismatched printout. Unlike every other per-vendor override (rates,
// billing thresholds), this one is self-service: the vendor sets it, not an
// admin, so there's no "global settings" row to fall back to - the default
// lives here in code.

export const DEFAULT_LABEL_WIDTH_MM = 100;
export const DEFAULT_LABEL_HEIGHT_MM = 75;

const MIN_LABEL_MM = 20;
const MAX_LABEL_MM = 300;

export interface VendorLabelSizeOverride {
  widthMm: number | null;
  heightMm: number | null;
}

export interface ResolvedLabelSize {
  widthMm: number;
  heightMm: number;
}

/** Null override (or no vendor at all - a branch-created order) falls back to
 *  the app default, the same shape as resolveThresholds() in
 *  billing.service.ts for the rate/threshold columns. */
export function resolveLabelSize(
  vendor: { label_width_mm: number | null; label_height_mm: number | null } | null | undefined,
): ResolvedLabelSize {
  return {
    widthMm: vendor?.label_width_mm ?? DEFAULT_LABEL_WIDTH_MM,
    heightMm: vendor?.label_height_mm ?? DEFAULT_LABEL_HEIGHT_MM,
  };
}

export async function getVendorLabelSize(vendorId: string): Promise<VendorLabelSizeOverride> {
  const vendor = await prisma.vendors.findFirst({
    where: { id: vendorId },
    select: { label_width_mm: true, label_height_mm: true },
  });
  if (!vendor) throw new AppError(404, "Vendor not found");

  return { widthMm: vendor.label_width_mm, heightMm: vendor.label_height_mm };
}

/** Both null resets to the default. Setting only one and clearing the other
 *  isn't a valid state - a label needs both dimensions or neither. */
export async function updateVendorLabelSize(
  vendorId: string,
  input: VendorLabelSizeOverride,
): Promise<VendorLabelSizeOverride> {
  const { widthMm, heightMm } = input;

  if ((widthMm === null) !== (heightMm === null)) {
    throw new AppError(400, "widthMm and heightMm must be set together, or both cleared");
  }

  for (const [label, value] of [
    ["widthMm", widthMm],
    ["heightMm", heightMm],
  ] as const) {
    if (value === null) continue;
    if (!Number.isInteger(value) || value < MIN_LABEL_MM || value > MAX_LABEL_MM) {
      throw new AppError(400, `${label} must be a whole number between ${MIN_LABEL_MM} and ${MAX_LABEL_MM}mm`);
    }
  }

  const vendor = await prisma.vendors.findFirst({ where: { id: vendorId }, select: { id: true } });
  if (!vendor) throw new AppError(404, "Vendor not found");

  await prisma.vendors.update({
    where: { id: vendorId },
    data: { label_width_mm: widthMm, label_height_mm: heightMm },
  });

  return { widthMm, heightMm };
}
