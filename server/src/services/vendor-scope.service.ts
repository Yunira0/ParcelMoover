import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

export type ScopeActor = { id: string; roles: string[] };

const STAFF_ROLES = ["super_admin", "admin"];

export function isStaffActor(actor: ScopeActor): boolean {
  return actor.roles.some((r) => STAFF_ROLES.includes(r));
}

/**
 * Resolves the vendor a vendor/vendor_staff actor belongs to. vendor_staff
 * always resolves through the vendor_staff table, never a caller-supplied
 * vendorId, so a staff account can never be pointed at another vendor's data.
 * Returns null when the actor is neither a vendor nor vendor_staff.
 */
export async function resolveOwnVendorId(actor: ScopeActor): Promise<string | null> {
  if (actor.roles.includes("vendor_staff")) {
    const staffRecord = await prisma.vendor_staff.findFirst({
      where: { user_id: actor.id, deleted_at: null, enabled: true },
      select: { vendor_id: true },
    });
    if (!staffRecord) throw new AppError(403, "Staff profile not found or inactive");
    return staffRecord.vendor_id;
  }

  if (actor.roles.includes("vendor")) {
    const vendor = await prisma.vendors.findFirst({
      where: { user_id: actor.id, deleted_at: null, status: "active" },
      select: { id: true },
    });
    if (!vendor) throw new AppError(403, "Vendor profile not found or inactive");
    return vendor.id;
  }

  return null;
}
