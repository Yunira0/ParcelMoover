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
    const userIds = await userIdsWithRoles(["super_admin", "admin"]);
    await deliver(userIds, title, body, trackingId, type, link, excludeUserId);
  } catch (error) {
    console.error("[Notifications] Failed to notify admins:", error);
  }
}

// Finance work waiting on the office (payment proofs to verify, COD settlement
// requests to action). Goes to super_admin, the accountant, and head-office
// admins only: a branch-scoped admin can't act on these, and other branches'
// deposits and vendors' payments are not theirs to see.
export async function notifyFinanceStaff(
  title: string,
  body: string | null,
  trackingId: string | null,
  type: string,
  link: string | null,
  excludeUserId?: string,
) {
  try {
    const [officeIds, adminIds] = await Promise.all([
      userIdsWithRoles(["super_admin", "accountant"]),
      userIdsWithRoles(["admin"]),
    ]);
    const headOfficeAdmins = adminIds.length === 0 ? [] : await prisma.admins.findMany({
      where: { user_id: { in: adminIds }, branch_scoped: false },
      select: { user_id: true },
    });
    const userIds = [...officeIds, ...headOfficeAdmins.map((a) => a.user_id)];
    await deliver(userIds, title, body, trackingId, type, link, excludeUserId);
  } catch (error) {
    console.error("[Notifications] Failed to notify finance staff:", error);
  }
}

async function userIdsWithRoles(roleCodes: string[]): Promise<string[]> {
  const rows = await prisma.user_roles.findMany({
    where: { roles: { code: { in: roleCodes } } },
    select: { user_id: true },
  });
  return rows.map((r) => r.user_id);
}

async function deliver(
  userIds: string[],
  title: string,
  body: string | null,
  trackingId: string | null,
  type: string,
  link: string | null,
  excludeUserId?: string,
) {
  const recipients = [...new Set(userIds)].filter((id) => id !== excludeUserId);
  await Promise.all(
    recipients.map((userId) =>
      createNotification(userId, title, body, trackingId, type, link),
    ),
  );
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

