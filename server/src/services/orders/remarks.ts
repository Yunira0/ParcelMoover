import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { displayAuthor } from "../../utils/carrierRemark";
import { createNotification } from "../notification.service";
import { getActorScope, riderHandledFilter, branchTouchesFilter } from "./scope";
import { isStaffAuthor } from "./remarkAuthor";
import type { OrderActor } from "./types";

export async function addOrderRemark(
  actor: OrderActor,
  parcelId: string,
  remarkText: string,
  parentRemarkId?: string | null,
) {
  const trimmed = remarkText.trim();
  if (!trimmed) {
    throw new AppError(400, "Remark text is required");
  }

  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);

  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
      ...(riderId ? riderHandledFilter(riderId) : {}),
      ...(branchLocationIds ? branchTouchesFilter(branchLocationIds) : {}),
    },
    select: { id: true, tracking_id: true },
  });

  if (!parcel) {
    throw new AppError(404, "Order not found");
  }

  let validParentId: string | null = null;
  if (parentRemarkId) {
    const parent = await prisma.parcel_remarks.findFirst({
      where: { id: parentRemarkId, parcel_id: parcel.id },
      select: { id: true },
    });
    if (!parent) {
      throw new AppError(400, "Remark being replied to was not found on this order");
    }
    validParentId = parent.id;
  }

  let locationId: string | null = null;
  if (actor.roles.includes("super_admin") || actor.roles.includes("admin")) {
    const admin = await prisma.admins.findUnique({
      where: { user_id: actor.id },
      select: { location_id: true },
    });
    locationId = admin?.location_id ?? null;
  } else if (riderId) {
    const rider = await prisma.riders.findUnique({
      where: { id: riderId },
      select: { location_id: true },
    });
    locationId = rider?.location_id ?? null;
  }

  const remark = await prisma.parcel_remarks.create({
    data: {
      parcel_id: parcel.id,
      user_id: actor.id,
      location_id: locationId,
      remark: trimmed,
      parent_remark_id: validParentId,
    },
    include: {
      users: true,
      parent_remark: {
        include: { users: { include: { user_roles: { include: { roles: true } } } } },
      },
    },
  });

  const parentAuthorId = remark.parent_remark?.users?.id;
  if (parentAuthorId && parentAuthorId !== actor.id) {
    await createNotification(
      parentAuthorId,
      `New reply on order ${parcel.tracking_id}`,
      trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed,
      parcel.tracking_id,
      "general",
      `/orders/track/${parcel.tracking_id}`,
    );
  }

  // Fire-and-forget: dynamic import avoids a static circular dependency with
  // ncm.service.ts (which itself imports from this file), and syncRemarkToNcm
  // is best-effort/self-catching, so a slow or unreachable NCM must never
  // delay this response.
  void import("../ncm.service").then(({ syncRemarkToNcm }) =>
    syncRemarkToNcm(parcel.id, `${remark.users?.full_name || "Staff"}: ${trimmed}`),
  );

  // The author is the actor themselves, so addedBy is safe; but a non-staff
  // actor replying to a staff remark must not learn the staff member's name.
  const isStaff =
    actor.roles.includes("super_admin") || actor.roles.includes("admin");
  const maskParent = !isStaff && isStaffAuthor(remark.parent_remark?.users);
  return {
    id: remark.id,
    remark: remark.remark,
    addedBy: displayAuthor(remark.users?.full_name),
    createdAt: remark.created_at.toISOString(),
    parentRemarkId: remark.parent_remark_id,
    parentAuthor: remark.parent_remark?.users
      ? maskParent
        ? "Staff"
        : remark.parent_remark.users.full_name
      : null,
    parentSnippet: remark.parent_remark?.remark || null,
  };
}

