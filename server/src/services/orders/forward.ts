import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { ForwardOrderInput } from "../../types/order.type";
import { invalidateVendorFinanceCache } from "../finance.service";
import { isStaffActor } from "../vendor-scope.service";
import { invalidateOrderCaches } from "./cache";
import { getAdminBranchScope, branchTouchesFilter } from "./scope";
import type { OrderActor } from "./types";

const DEFAULT_FORWARD_REASON = "Forwarded to another destination";

/**
 * Add a forwarding charge to an already-delivered parcel that had to be
 * forwarded on to a different destination (e.g. by NCM). Admin/super_admin only.
 *
 * The twin of redirectOrder, but for after delivery: the status stays
 * "delivered", only the destination changes (the receiver's address is left
 * alone), and the manually entered forwarding charge is added on top of the
 * delivery charge. Logged in parcel_redirects with status_at_redirect =
 * "delivered" - which no redirect can have - so no extra column is needed to
 * tell forwards apart.
 *
 * Refused once the parcel's money is settled: a vendor settlement or branch
 * settlement already froze this parcel's charge, and changing it here would
 * desync from that statement with no record of why.
 */
export async function forwardOrder(
  actor: OrderActor,
  parcelId: string,
  data: ForwardOrderInput,
) {
  if (!isStaffActor(actor)) {
    throw new AppError(403, "Only an admin can add a forwarding charge");
  }

  const adminBranchIds = await getAdminBranchScope(actor);
  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      deleted_at: null,
      ...(adminBranchIds ? branchTouchesFilter(adminBranchIds) : {}),
    },
    include: {
      parties_parcels_receiver_idToparties: true,
      locations_parcels_destination_location_idTolocations: true,
      cod_collections: {
        select: {
          payment_status: true,
          settlement_items: { select: { settlements: { select: { statement_id: true, payee_type: true } } }, take: 1 },
        },
      },
      branch_settlement_items: { select: { settlement_id: true }, take: 1 },
    },
  });
  if (!parcel) throw new AppError(404, "Order not found");

  if (parcel.status !== "delivered") {
    throw new AppError(409, "A forwarding charge can only be added to a delivered order");
  }

  const collection = parcel.cod_collections;
  if (collection && collection.payment_status !== "pending") {
    throw new AppError(409, "This order has already been settled to the vendor; its charge can no longer change.");
  }
  if (collection && collection.settlement_items.length > 0) {
    const stmt = collection.settlement_items[0]!.settlements;
    throw new AppError(
      409,
      `This order is part of ${stmt.payee_type} settlement ${stmt.statement_id} — remove it from the settlement before adding a forwarding charge.`,
    );
  }
  if (parcel.branch_settlement_items.length > 0) {
    throw new AppError(409, "This order is already in a branch settlement; its charge can no longer change.");
  }

  const destination = await prisma.locations.findUnique({
    where: { id: data.destinationLocationId },
  });
  if (!destination || !destination.is_active) {
    throw new AppError(400, "Destination location not found or inactive");
  }
  if (parcel.destination_location_id === destination.id) {
    throw new AppError(400, "Pick a different destination to forward this order to");
  }

  const reason = data.reason?.trim() || DEFAULT_FORWARD_REASON;
  const address = parcel.parties_parcels_receiver_idToparties.address;
  const oldCharge = Number(parcel.delivery_charge);
  const newCharge = oldCharge + data.forwardingCharge;
  const oldBranchName = parcel.locations_parcels_destination_location_idTolocations?.name ?? null;

  const result = await prisma.$transaction(async (tx) => {
    const updatedParcel = await tx.parcels.update({
      where: { id: parcel.id },
      data: {
        destination_location_id: destination.id,
        delivery_charge: newCharge,
      },
    });

    const forward = await tx.parcel_redirects.create({
      data: {
        parcel_id: parcel.id,
        from_location_id: parcel.destination_location_id,
        to_location_id: destination.id,
        from_address: address,
        to_address: address,
        reason,
        status_at_redirect: parcel.status,
        old_delivery_charge: oldCharge,
        redirect_charge: data.forwardingCharge,
        new_delivery_charge: newCharge,
        created_by: actor.id,
      },
    });

    // Same-status history row, as redirects do: the parcel stays delivered,
    // but the timeline should show the forwarding.
    await tx.parcel_status_history.create({
      data: {
        parcel_id: parcel.id,
        old_status: parcel.status,
        new_status: parcel.status,
        location_id: parcel.current_location_id,
        changed_by: actor.id,
        remarks: `Forwarded — ${oldBranchName ?? "—"} → ${destination.name}, forwarding charge Rs. ${data.forwardingCharge} (${reason})`.slice(0, 500),
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "FORWARD_ORDER",
        old_data: {
          destinationLocationId: parcel.destination_location_id,
          destination: oldBranchName,
          deliveryCharge: oldCharge,
        },
        new_data: {
          destinationLocationId: destination.id,
          destination: destination.name,
          deliveryCharge: newCharge,
          forwardingCharge: data.forwardingCharge,
          reason,
        },
      },
    });

    return { parcel: updatedParcel, forward };
  });

  // Awaited so the very next read (the page reloads right after) sees the new charge.
  await Promise.all([
    invalidateOrderCaches(),
    parcel.vendor_id ? invalidateVendorFinanceCache(parcel.vendor_id) : Promise.resolve(),
  ]).catch((err) => console.error("[Redis] cache invalidation failed:", err));

  return {
    id: result.parcel.id,
    trackingId: result.parcel.tracking_id,
    status: result.parcel.status,
    destination: destination.name,
    deliveryCharge: newCharge,
    forwardingCharge: data.forwardingCharge,
    forwardedAt: result.forward.created_at,
  };
}
