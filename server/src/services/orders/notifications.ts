import prisma from "../../lib/prisma";
import { createNotification } from "../notification.service";

// Notify all active admin/super_admin users (fire-and-forget).
export async function notifyAdmins(
  title: string,
  body: string | null,
  trackingId: string | null,
  type: string,
  link: string | null,
  excludeUserId?: string,
) {
  try {
    const adminRoles = await prisma.roles.findMany({
      where: { code: { in: ["super_admin", "admin"] } },
      select: { id: true },
    });
    const roleIds = adminRoles.map((r) => r.id);
    if (roleIds.length === 0) return;

    const adminUsers = await prisma.user_roles.findMany({
      where: { role_id: { in: roleIds } },
      select: { user_id: true },
    });
    const userIds = [...new Set(adminUsers.map((ur) => ur.user_id))].filter(
      (id) => id !== excludeUserId,
    );
    if (userIds.length === 0) return;

    await Promise.all(
      userIds.map((userId) =>
        createNotification(userId, title, body, trackingId, type, link),
      ),
    );
  } catch (error) {
    console.error("[Notifications] Failed to notify admins:", error);
  }
}

// Notify the vendor owner of a parcel (fire-and-forget). Resolves the vendor's
// user_id from the parcel's vendor_id and sends a single notification.
export async function notifyVendorOfParcel(
  vendorId: string | null,
  title: string,
  body: string | null,
  trackingId: string | null,
  type: string,
  link: string | null,
) {
  if (!vendorId) return;
  try {
    const vendor = await prisma.vendors.findUnique({
      where: { id: vendorId },
      select: { user_id: true },
    });
    if (!vendor?.user_id) return;
    await createNotification(vendor.user_id, title, body, trackingId, type, link);
  } catch (error) {
    console.error("[Notifications] Failed to notify vendor:", error);
  }
}

