import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { formatNepalDate as formatDate } from "../../utils/nepalTime";
import { getVendorStatusLabel } from "../../utils/orderStatusLabel";
import { displayAuthor, displayRemarkText, stripCarrierStaffTag } from "../../utils/carrierRemark";
import { getActorScope, riderHandledFilter, branchTouchesFilter } from "./scope";
import { isStaffAuthor } from "./remarkAuthor";
import { locationName, mapOrder } from "./query-core";
import type { OrderActor } from "./types";

const ORDER_DETAIL_INCLUDE = {
  parties_parcels_sender_idToparties: true,
  parties_parcels_receiver_idToparties: true,
  locations_parcels_origin_location_idTolocations: true,
  locations_parcels_destination_location_idTolocations: true,
  vendors: true,
  riders_parcels_pickup_rider_idToriders: true,
  riders_parcels_delivery_rider_idToriders: true,
  parcel_remarks: {
    orderBy: { created_at: "desc" as const },
    include: {
      users: { include: { user_roles: { include: { roles: true } } } },
      parent_remark: {
        include: { users: { include: { user_roles: { include: { roles: true } } } } },
      },
    },
  },
  parcel_status_history: {
    orderBy: { created_at: "desc" as const },
    include: {
      users: { include: { user_roles: { include: { roles: true } } } },
      locations: true,
    },
  },
  parcel_redirects: {
    orderBy: { created_at: "desc" as const },
    include: {
      users: { include: { user_roles: { include: { roles: true } } } },
      from_location: true,
      to_location: true,
    },
  },
  // Detail spreads mapOrder, so it needs everything mapOrder reads.
  cod_collections: { select: { collected_amount: true } },
} satisfies Prisma.parcelsInclude;

// NCM 3PL bookkeeping remarks. The handoff remark is an internal audit/link
// row (see ncm.service.ts) and must not show in the user-facing thread.
// Inbound carrier-staff comments carry a bracketed tag we strip for display,
// attributing them to a generic "Staff" (they have no local user). See
// utils/carrierRemark.ts - the tag spelling lives there so it cannot drift
// away from what ncm.service.ts actually writes.
const NCM_HANDOFF_PREFIX = "[NCM] Handed off";

export async function getOrderByTrackingId(actor: OrderActor, trackingId: string) {
  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");

  const parcel = await prisma.parcels.findFirst({
    where: {
      tracking_id: trackingId,
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
      ...(riderId ? riderHandledFilter(riderId) : {}),
      ...(branchLocationIds ? branchTouchesFilter(branchLocationIds) : {}),
    },
    include: ORDER_DETAIL_INCLUDE,
  });

  if (!parcel) {
    throw new AppError(404, "Order not found");
  }

  const vendorName = parcel.vendors?.business_name || parcel.vendors?.client_name || "";

  // Price Log: every admin/vendor edit that moved this parcel's COD or delivery
  // charge, derived from the UPDATE_ORDER audit trail. Lets a vendor see exactly
  // when and by how much their money figures were adjusted after order creation.
  const priceAudits = await prisma.audit_logs.findMany({
    where: { entity_type: "parcel", entity_id: parcel.id, action: "UPDATE_ORDER" },
    orderBy: { created_at: "desc" },
    include: { users: { include: { user_roles: { include: { roles: true } } } } },
  });
  const priceLog = priceAudits.flatMap((log) => {
    const oldData = (log.old_data ?? {}) as Record<string, unknown>;
    const newData = (log.new_data ?? {}) as Record<string, unknown>;
    // Staff see who edited; vendors see a generic "Admin" for internal staff
    // edits (their own edits still show their name), matching the masking used
    // for remarks and status history.
    const changedBy = isStaff
      ? log.users?.full_name || "System"
      : isStaffAuthor(log.users)
        ? "Admin"
        : log.users?.full_name || "Admin";
    // Raw ISO timestamp (carries the time) so the client can render it as a
    // BS date + Nepal-local time via toBsDateTime.
    const at = log.created_at.toISOString();
    const rows: {
      id: string;
      field: "cod" | "delivery_charge";
      oldValue: number;
      newValue: number;
      changedBy: string;
      createdAt: string;
    }[] = [];
    const oldCod = Number(oldData.codAmount);
    const newCod = Number(newData.codAmount);
    if (Number.isFinite(oldCod) && Number.isFinite(newCod) && oldCod !== newCod) {
      rows.push({ id: `${log.id}-cod`, field: "cod", oldValue: oldCod, newValue: newCod, changedBy, createdAt: at });
    }
    const oldDc = Number(oldData.deliveryCharge);
    const newDc = Number(newData.deliveryCharge);
    if (Number.isFinite(oldDc) && Number.isFinite(newDc) && oldDc !== newDc) {
      rows.push({ id: `${log.id}-dc`, field: "delivery_charge", oldValue: oldDc, newValue: newDc, changedBy, createdAt: at });
    }
    return rows;
  });

  // Redirect log: every destination change made because the customer moved.
  // Author masking matches the price log - vendors/riders see "Admin", not the
  // staff member's real name.
  const redirectLog = parcel.parcel_redirects.map((entry) => ({
    id: entry.id,
    fromBranch: entry.from_location?.name ?? null,
    toBranch: entry.to_location.name,
    fromAddress: entry.from_address,
    toAddress: entry.to_address,
    reason: entry.reason,
    statusAtRedirect: entry.status_at_redirect,
    oldDeliveryCharge: Number(entry.old_delivery_charge),
    redirectCharge: Number(entry.redirect_charge),
    newDeliveryCharge: Number(entry.new_delivery_charge),
    redirectedBy: isStaff
      ? entry.users?.full_name || "System"
      : isStaffAuthor(entry.users)
        ? "Admin"
        : entry.users?.full_name || "Admin",
    createdAt: entry.created_at.toISOString(),
  }));

  // Attached shipping voucher, if any — one extra indexed lookup on the detail
  // view only (never on the list path), so the order can name its code.
  let voucher: { code: string; title: string } | null = null;
  if (parcel.voucher_claim_id) {
    const claim = await prisma.voucher_claims.findUnique({ where: { id: parcel.voucher_claim_id } });
    if (claim) {
      const offer = await prisma.vouchers.findUnique({ where: { id: claim.voucher_id }, select: { code: true, title: true } });
      if (offer) voucher = { code: offer.code, title: offer.title };
    }
  }

  return {
    ...mapOrder(parcel, isStaff, !!vendorId),
    canChangeStatus: isStaff,
    priceLog,
    redirectLog,
    voucher,
    // Staff see the real author name; vendors/riders see a generic "Staff"
    // label in place of any internal staff member's name (their own / other
    // non-staff authors still show normally).
    remarks: parcel.parcel_remarks
      .filter((remark) => !remark.remark.startsWith(NCM_HANDOFF_PREFIX))
      .map((remark) => {
      const { text: remarkText, isCarrierStaff } = stripCarrierStaffTag(remark.remark);
      const maskAuthor = !isStaff && isStaffAuthor(remark.users);
      const maskParent = !isStaff && isStaffAuthor(remark.parent_remark?.users);
      return {
        id: remark.id,
        remark: remarkText,
        addedBy: displayAuthor(remark.users?.full_name, isCarrierStaff || maskAuthor),
        createdAt: remark.created_at.toISOString(),
        parentRemarkId: remark.parent_remark_id,
        parentAuthor: remark.parent_remark?.users
          ? maskParent
            ? "Staff"
            : remark.parent_remark.users.full_name
          : null,
        parentSnippet: remark.parent_remark?.remark || null,
      };
    }),
    // Staff see who (which user) changed the status; vendors/riders see "Staff"
    // for internal staff changes and the branch/company name for branch-driven
    // ones - never an internal staff member's real name.
    statusHistory: parcel.parcel_status_history.map((entry) => {
      const branchLabel = entry.locations?.name || vendorName || "Branch";
      const nonStaffLabel = isStaffAuthor(entry.users) ? "Staff" : branchLabel;
      // Rider-driven milestones surface the assigned rider's name next to the
      // status ("Rider Assigned (Sunita Devi)"): pickup rider for
      // "rider_assigned", delivery rider for "sent_for_delivery". "changedBy"
      // below still shows who performed the assignment.
      const riderName =
        entry.new_status === "rider_assigned"
          ? parcel.riders_parcels_pickup_rider_idToriders?.name
          : entry.new_status === "sent_for_delivery"
            ? parcel.riders_parcels_delivery_rider_idToriders?.name
            : null;
      return {
        id: entry.id,
        oldStatus: entry.old_status,
        newStatus: entry.new_status,
        // One wording for both carriers, and no carrier's own name - the
        // handoff entry is stored branded on the Upaya side (see carrierRemark).
        remarks: displayRemarkText(entry.remarks || ""),
        riderName: riderName || null,
        changedBy: isStaff ? entry.users?.full_name || "System" : nonStaffLabel,
        changedByType: isStaff ? ("user" as const) : ("branch" as const),
        // Full timestamp so the timeline shows the time of each status change.
        createdAt: entry.created_at.toISOString(),
      };
    }),
  };
}

// Unauthenticated lookup for the public landing-page tracker. Tracking IDs
// are unguessable (13 random base32 chars + check digit, validated by the
// controller before this runs), so an exact match alone is an acceptable
// access check - but the payload must stay limited to what a passer-by
// tracking their own parcel needs. No party phone/address, no COD/pricing,
// no staff or vendor identity - just shipment status and public hub names.
export async function getPublicOrderTracking(trackingId: string) {
  const parcel = await prisma.parcels.findFirst({
    where: { tracking_id: trackingId, deleted_at: null },
    include: {
      locations_parcels_origin_location_idTolocations: true,
      locations_parcels_destination_location_idTolocations: true,
      parcel_status_history: {
        orderBy: { created_at: "desc" as const },
        include: { locations: true },
      },
    },
  });

  if (!parcel) {
    throw new AppError(404, "No parcel found with this tracking ID");
  }

  return {
    trackingId: parcel.tracking_id,
    status: parcel.status,
    statusLabel: getVendorStatusLabel(parcel.status),
    serviceType: parcel.service_type,
    pieces: parcel.pieces,
    origin: locationName(parcel.locations_parcels_origin_location_idTolocations) || "",
    destination: locationName(parcel.locations_parcels_destination_location_idTolocations) || "",
    createdAt: formatDate(parcel.created_at),
    lastUpdatedAt: formatDate(parcel.parcel_status_history[0]?.created_at || parcel.updated_at),
    statusHistory: parcel.parcel_status_history.map((entry) => ({
      status: entry.new_status,
      location: entry.locations?.name || null,
      createdAt: formatDate(entry.created_at),
    })),
  };
}

// Bulk status lookup for reconciliation - scoped the same way
// getOrderByTrackingId is. Requested ids that don't resolve (wrong vendor,
// typo, deleted) land in `notFound` instead of silently vanishing, so a
// polling client can tell "not mine / doesn't exist" from "still processing."
export async function getOrderStatusesByTrackingIds(actor: OrderActor, trackingIds: string[]) {
  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);

  const parcels = await prisma.parcels.findMany({
    where: {
      tracking_id: { in: trackingIds },
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
      ...(riderId ? riderHandledFilter(riderId) : {}),
      ...(branchLocationIds ? branchTouchesFilter(branchLocationIds) : {}),
    },
    select: { tracking_id: true, status: true, updated_at: true },
  });

  const found = new Set(parcels.map((p) => p.tracking_id));
  const notFound = trackingIds.filter((id) => !found.has(id));

  return {
    data: parcels.map((p) => ({
      trackingId: p.tracking_id,
      status: p.status,
      statusLabel: getVendorStatusLabel(p.status),
      updatedAt: p.updated_at,
    })),
    notFound,
  };
}
