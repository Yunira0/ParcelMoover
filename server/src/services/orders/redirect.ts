import { parcel_status } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { RedirectOrderInput } from "../../types/order.type";
import { invalidateVendorFinanceCache } from "../finance.service";
import { isStaffActor } from "../vendor-scope.service";
import { invalidateOrderCaches } from "./cache";
import { buildSearchText } from "./orderHelpers";
import { getAdminBranchScope, branchTouchesFilter } from "./scope";
import type { OrderActor } from "./types";

const REDIRECT_ALLOWED_STATUSES: parcel_status[] = [
  "pickup_ordered",
  "rider_assigned",
  "picked_up",
  "arrived",
  "ready_to_deliver",
  "sent_for_delivery",
  "oov",
  "dispatched",
  "arrived_at_branch",
  "hold",
  "failed_delivery",
  "follow_up",
];

/**
 * Redirect a parcel to a different destination branch + address because the
 * customer moved. Admin/super_admin only.
 *
 * Deliberately separate from updateOrderDetails: it always demands a reason,
 * never re-prices the route (the original charge stands) and instead adds the
 * diversion fee on top, and writes a parcel_redirects row so ops can audit and
 * count redirects per branch.
 */
export async function redirectOrder(
  actor: OrderActor,
  parcelId: string,
  data: RedirectOrderInput,
) {
  if (!isStaffActor(actor)) {
    throw new AppError(403, "Only an admin can redirect an order");
  }

  const adminBranchIds = await getAdminBranchScope(actor);
  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      deleted_at: null,
      ...(adminBranchIds ? branchTouchesFilter(adminBranchIds) : {}),
    },
    include: {
      parties_parcels_sender_idToparties: true,
      parties_parcels_receiver_idToparties: true,
      locations_parcels_destination_location_idTolocations: true,
    },
  });
  if (!parcel) throw new AppError(404, "Order not found");

  if (!REDIRECT_ALLOWED_STATUSES.includes(parcel.status)) {
    throw new AppError(409, `An order in status "${parcel.status}" can no longer be redirected`);
  }

  const destination = await prisma.locations.findUnique({
    where: { id: data.destinationLocationId },
  });
  if (!destination || !destination.is_active) {
    throw new AppError(400, "Destination location not found or inactive");
  }

  const newAddress = data.address.trim();
  const oldAddress = parcel.parties_parcels_receiver_idToparties.address;
  const sameBranch = parcel.destination_location_id === destination.id;
  if (sameBranch && newAddress === (oldAddress ?? "")) {
    throw new AppError(400, "Pick a different destination branch or address to redirect this order");
  }

  const oldCharge = Number(parcel.delivery_charge);
  const newCharge = oldCharge + data.redirectCharge;
  const oldBranchName = parcel.locations_parcels_destination_location_idTolocations?.name ?? null;

  const result = await prisma.$transaction(async (tx) => {
    // The receiver party row is shared by phone (upsertPartyByPhone), so the
    // address change lands on the same record every other parcel for this
    // customer points at - which is what "the customer moved" means.
    const receiver = await tx.parties.update({
      where: { id: parcel.receiver_id },
      data: { address: newAddress },
    });

    const updatedParcel = await tx.parcels.update({
      where: { id: parcel.id },
      data: {
        destination_location_id: destination.id,
        delivery_charge: newCharge,
        search_text: buildSearchText(
          parcel.tracking_id,
          parcel.parties_parcels_sender_idToparties,
          receiver,
        ),
      },
    });

    const redirect = await tx.parcel_redirects.create({
      data: {
        parcel_id: parcel.id,
        from_location_id: parcel.destination_location_id,
        to_location_id: destination.id,
        from_address: oldAddress,
        to_address: newAddress,
        reason: data.reason.trim(),
        status_at_redirect: parcel.status,
        old_delivery_charge: oldCharge,
        redirect_charge: data.redirectCharge,
        new_delivery_charge: newCharge,
        created_by: actor.id,
      },
    });

    // Sequential, not Promise.all: tx is one Postgres connection, so
    // "concurrent" queries against it just pipeline on that client - pg now
    // deprecates that (removed in pg@9). Same cost, awaited one at a time.
    // Same-status history row, matching how parcel edits are recorded: the
    // parcel didn't move, but the timeline should show the diversion.
    await tx.parcel_status_history.create({
      data: {
        parcel_id: parcel.id,
        old_status: parcel.status,
        new_status: parcel.status,
        location_id: parcel.current_location_id,
        changed_by: actor.id,
        remarks: `Redirected — ${oldBranchName ?? "—"} → ${destination.name} (${data.reason.trim()})`.slice(0, 500),
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "REDIRECT_ORDER",
        old_data: {
          destinationLocationId: parcel.destination_location_id,
          destination: oldBranchName,
          address: oldAddress,
          deliveryCharge: oldCharge,
        },
        new_data: {
          destinationLocationId: destination.id,
          destination: destination.name,
          address: newAddress,
          deliveryCharge: newCharge,
          redirectCharge: data.redirectCharge,
          reason: data.reason.trim(),
        },
      },
    });

    return { parcel: updatedParcel, redirect };
  });

  invalidateOrderCaches().catch((err) => console.error("[Redis] cache invalidation failed:", err));
  if (parcel.vendor_id) {
    invalidateVendorFinanceCache(parcel.vendor_id).catch((err) =>
      console.error("[Redis] cache invalidation failed:", err),
    );
  }

  return {
    id: result.parcel.id,
    trackingId: result.parcel.tracking_id,
    status: result.parcel.status,
    destination: destination.name,
    address: newAddress,
    deliveryCharge: newCharge,
    redirectedAt: result.redirect.created_at,
  };
}

