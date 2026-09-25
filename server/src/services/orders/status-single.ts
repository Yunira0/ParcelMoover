import { parcel_status, Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { ParcelStatus, STATUS_TRANSITIONS, UpdateParcelStatusInput } from "../../types/order.type";
import { evaluateVendorBillingAsync, statusAffectsBalance } from "../billing.service";
import { invalidateVendorFinanceCache, invalidateRiderFinanceCache } from "../finance.service";
import { createNotification } from "../notification.service";
import { emitWebhookEvent } from "../webhookDispatch.service";
import { invalidateOrderCaches } from "./cache";
import { buildSearchText, createRunSheet, generateUniqueTrackingId } from "./orderHelpers";
import { notifyVendorOfParcel } from "./notifications";
import { computeReturnCharge } from "./pricing";
import { getActorScope, getAdminBranchScope, resolveActiveRider } from "./scope";
import {
  DELIVERY_RIDER_HELD_STATUSES,
  HUB_OPERATION_STATUSES,
  OPS_RESTRICTED_STATUSES,
  REASON_REQUIRED_STATUSES,
  RETURN_WORKFLOW_STATUSES,
  RIDER_ASSIGNMENT_FIELD,
  TERMINAL_STATUSES,
  assertRiderOwnsLeg,
  destinationSkipsTransit,
  isUndelivering,
  pickupStampFor,
  releasesPickupRider,
} from "./status-shared";
import { withParcelStatusLocks } from "./statusLocks";
import type { OrderActor } from "./types";

// ── Undoing a delivery ───────────────────────────────────────────────────────
// Only a super_admin can force a parcel back out of delivered/partially_
// delivered. That has to reverse everything the delivery wrote, because the COD
// ledger is what finance settles on: left alone, cod_collections keeps its
// delivery-time collected_amount forever, and since a later COD edit only
// re-syncs cod_amount (see updateOrder), the parcel ends up with COD 0 but a
// non-zero collected amount - still listed as settleable, still counted in the
// vendor's balance, for cash nobody is holding.

/**
 * Blocks the un-delivery when the COD has already been bundled into a statement
 * or paid on either leg. Real money has moved at that point (and
 * rider_remitted_amount / remitted_amount are frozen copies of the collected
 * amount), so the statement has to be voided first - silently rewriting the
 * ledger underneath a paid settlement would leave the books unbalanced.
 */
async function assertDeliveryReversible(parcelIds: string[]) {
  const blocked = await prisma.cod_collections.findMany({
    where: {
      parcel_id: { in: parcelIds },
      OR: [
        { payment_status: "paid" },
        { rider_payment_status: "paid" },
        { settlement_items: { some: {} } },
      ],
    },
    select: { parcels: { select: { tracking_id: true } } },
  });
  if (blocked.length > 0) {
    const tags = blocked.map((c) => c.parcels.tracking_id).join(", ");
    throw new AppError(
      409,
      `Cannot move ${tags} out of a delivered status: its COD is already in a settlement statement. Void or amend that statement first.`,
    );
  }
}

export async function updateParcelStatus(
  actor: OrderActor,
  parcelId: string,
  data: UpdateParcelStatusInput,
) {
  return withParcelStatusLocks([parcelId], () => _updateParcelStatusImpl(actor, parcelId, data));
}

async function _updateParcelStatusImpl(
  actor: OrderActor,
  parcelId: string,
  data: UpdateParcelStatusInput,
) {
  const parcel = await prisma.parcels.findFirst({
    where: { id: parcelId, deleted_at: null },
    include: {
      pickup_tasks: true,
      parties_parcels_sender_idToparties: true,
      parties_parcels_receiver_idToparties: true,
      vendors: true,
      locations_parcels_destination_location_idTolocations: true,
    },
  });

  if (!parcel) {
    throw new AppError(404, "Parcel not found");
  }

  const currentStatus = parcel.status as ParcelStatus;
  const newStatus = data.status;
  // The parcel is leaving the delivery leg for something else - a super_admin
  // force-status override back to ready_to_deliver, the already-legal
  // partially_delivered → follow_up / ready_to_return, or a failed attempt
  // released back into the pool. Either way it's no longer out with the
  // delivery rider, so the rider's claim on it is released.
  //
  // failed_delivery must be in this set: without it a released parcel kept its
  // old delivery_rider_id all the way through ready_to_deliver → hold → oov
  // onto a 3PL leg, and applyExternalCarrierStatus then credited NCM's
  // collected cash to that rider's COD settlement.
  const leavingDelivery =
    DELIVERY_RIDER_HELD_STATUSES.includes(currentStatus as parcel_status) &&
    !DELIVERY_RIDER_HELD_STATUSES.includes(newStatus as parcel_status);
  // ...but only retracting a COMPLETED delivery reverses the money, and that
  // question is narrower than leavingDelivery above - a super_admin forcing
  // delivered → sent_for_delivery keeps the parcel on the delivery leg (so the
  // rider is not released) while still undoing a delivery that didn't happen.
  // Kept on its own terms rather than derived, and matching reversalParcels in
  // the bulk path exactly.
  //
  // On a partial the customer really did take goods and really did hand over
  // cash: moving the remainder to follow_up/ready_to_return continues that
  // workflow, it does not undo the payment. Zeroing the collection there would
  // erase cash the rider is still holding and still owes the office.
  const isDeliveryReversal =
    currentStatus === "delivered" &&
    !["delivered", "partially_delivered"].includes(newStatus);

  // Delivering an exchange order requires confirming the customer's exchange
  // (return) parcel was received to carry back. Riders cannot complete the
  // delivery without it; confirming (any actor) auto-creates the linked return.
  const isExchangeDelivery = parcel.order_type === "exchange" && newStatus === "delivered";
  const actorIsRider = actor.roles.includes("rider");
  if (isExchangeDelivery && actorIsRider && !data.exchangeReturnReceived) {
    throw new AppError(
      400,
      "Confirm you received the exchange return parcel before completing this delivery",
    );
  }
  const shouldRaiseReturn = isExchangeDelivery && data.exchangeReturnReceived === true;
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  // A super_admin may force any status from any status (including out of a
  // terminal state) - the transition map only constrains everyone else.
  const isSuperAdmin = actor.roles.includes("super_admin");

  // Ownership scoping: vendors/vendor_staff may only touch their own parcels,
  // and riders may only touch parcels they're actually assigned to, and only
  // for the leg (pickup vs delivery) they were assigned for.
  const isVendorActor = actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
  if (!isAdmin) {
    const isRiderActor = actor.roles.includes("rider");

    if (isVendorActor) {
      const { vendorId } = await getActorScope(actor);
      if (parcel.vendor_id !== vendorId) {
        throw new AppError(404, "Parcel not found");
      }
    } else if (actor.roles.includes("sales")) {
      // Defense in depth: sales are not currently routed to status updates, but
      // if they ever are, scope them to parcels of the vendors they own.
      const { vendorIds } = await getActorScope(actor);
      if (!vendorIds || !parcel.vendor_id || !vendorIds.includes(parcel.vendor_id)) {
        throw new AppError(404, "Parcel not found");
      }
    } else if (isRiderActor) {
      // Assigning a rider to a parcel (rider_assigned / sent_for_delivery /
      // sent_to_vendor) is an admin/vendor operation done via the ops
      // dashboard's rider picker — a rider never claims/assigns a parcel to
      // themselves, so reject this before the leg-ownership check below
      // (which, on the very first assignment, would otherwise always fail
      // with a misleading "not your parcel" error instead of the real reason).
      if (RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status]) {
        throw new AppError(403, "Assigning a rider to a parcel is an admin/vendor operation");
      }
      const scope = await getActorScope(actor);
      if (!scope.riderId) {
        throw new AppError(403, "Rider profile not found or inactive");
      }
      assertRiderOwnsLeg(currentStatus as parcel_status, parcel, scope.riderId);
    }
  }

  // A branch-scoped admin can act on this same set of statuses as any other
  // admin (isAdmin above bypasses the block it sits in) - but only for a
  // parcel that actually touches their branch. Checked regardless of isAdmin,
  // since getAdminBranchScope itself already resolves to undefined for
  // super_admin and for an admin who isn't branch_scoped.
  const adminBranchIds = await getAdminBranchScope(actor);
  if (adminBranchIds) {
    const touchesBranch =
      (parcel.origin_location_id && adminBranchIds.includes(parcel.origin_location_id)) ||
      (parcel.destination_location_id && adminBranchIds.includes(parcel.destination_location_id)) ||
      (parcel.current_location_id && adminBranchIds.includes(parcel.current_location_id));
    if (!touchesBranch) {
      throw new AppError(404, "Parcel not found");
    }
  }

  // cannot transition from a terminal state
  if (!isSuperAdmin && TERMINAL_STATUSES.includes(currentStatus as parcel_status)) {
    throw new AppError(
      409,
      `Cannot update status: parcel id already '${currentStatus}' (terminal state)`,
    );
  }

  // Idempotent no-op: a parcel already at the requested status isn't a
  // transition at all - STATUS_TRANSITIONS uniformly disallows self-
  // transitions, so this can only mean the parcel got here between the
  // client rendering it and this request landing (another actor's request,
  // a reconcile sweep, or the caller's own resubmitted scan). Report success
  // instead of 422ing on 'X → X'; there is nothing left to do.
  if (!isSuperAdmin && currentStatus === newStatus) {
    return parcel;
  }

  // validate the transition is allowed
  if (!isSuperAdmin) {
    const allowed = STATUS_TRANSITIONS[
      currentStatus as keyof typeof STATUS_TRANSITIONS
    ] as readonly ParcelStatus[];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new AppError(
        422,
        `Invalid status transition: '${currentStatus}' → '${newStatus}'. Allowed: [${allowed?.join(", ")}]`,
      );
    }

    // From "arrived", destination decides whether the parcel skips Transit
    // (inside valley + fringe areas) or must go through it (everywhere else) —
    // only one of the two branch-allowed next statuses is actually valid.
    if (currentStatus === "arrived" && (newStatus === "ready_to_deliver" || newStatus === "oov")) {
      const skipsTransit = destinationSkipsTransit(parcel.locations_parcels_destination_location_idTolocations);
      if (skipsTransit && newStatus === "oov") {
        throw new AppError(422, "Destination is inside the valley: this parcel must go to 'Ready to Deliver', not 'Transit'.");
      }
      if (!skipsTransit && newStatus === "ready_to_deliver") {
        throw new AppError(422, "Destination is outside the valley: this parcel must go to 'Transit' first.");
      }
    }
  }

  // Undoing a delivery (super_admin only, since the transition map has no exit
  // from delivered) must not leave settled COD behind it.
  const undelivering = isUndelivering(parcel.status, newStatus);
  if (undelivering) {
    await assertDeliveryReversible([parcelId]);
  }

  // Cancellation is allowed for admins and vendors (vendors may only cancel their own
  // orders, enforced by the vendor_id scope on the parcel lookup above) — kept in sync
  // with the bulk-update rule in _bulkUpdateParcelStatusImpl.
  if (newStatus === "cancelled" && !isAdmin && !isVendorActor) {
    throw new AppError(403, "Only vendors or admins can cancel orders");
  }

  // building/closing a dispatch manifest is a branch operation
  if (HUB_OPERATION_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can perform dispatch hub operations");
  }

  // the return-to-origin workflow is managed by staff, not riders/vendors
  if (RETURN_WORKFLOW_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can manage the return workflow");
  }

  // hold / loss & damage are managed from the ops dashboard, not riders/vendors
  if (OPS_RESTRICTED_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can manage hold / loss & damage status");
  }

  // loss & damage is a head-office write-off classification - a branch-scoped
  // admin may release a hold back into the active flow but not write it off.
  if (newStatus === "loss_and_damage" && adminBranchIds) {
    throw new AppError(403, "Only head office can mark loss & damage");
  }

  if (data.locationId) {
    const loc = await prisma.locations.findUnique({
      where: { id: data.locationId },
    });
    if (!loc || !loc.is_active) {
      throw new AppError(400, "Location not found or inactive");
    }
  }

  // rider_assigned needs a pickup rider, sent_for_delivery needs a delivery rider
  // (rider actors are already rejected above, before reaching this point)
  const riderAssignmentField = RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status];
  if (riderAssignmentField) {
    if (!data.riderId) {
      throw new AppError(400, `riderId is required to transition to '${newStatus}'`);
    }
    await resolveActiveRider(data.riderId);
  }

  // Validate partially_delivered requirements
  if (newStatus === "partially_delivered") {
    if (!data.remarks || data.remarks.trim().length === 0) {
      throw new AppError(400, "Remarks are required when status is partially_delivered");
    }
    if (data.codCollected === undefined || data.codCollected < 0) {
      throw new AppError(400, "COD collected is required and must be non-negative when status is partially_delivered");
    }
    const totalCod = Number(parcel.cod_amount);
    if (data.codCollected > totalCod) {
      throw new AppError(400, `COD collected (${data.codCollected}) cannot exceed parcel's total COD (${totalCod})`);
    }
  }

  // Cancelling or failing an order requires a reason.
  if (REASON_REQUIRED_STATUSES.includes(newStatus as parcel_status)) {
    if (!data.remarks || data.remarks.trim().length === 0) {
      throw new AppError(400, "Remarks are required to cancel or fail an order");
    }
  }

  // Pre-compute the auto-created return parcel's delivery charge (the vendor's
  // return percent of the normal rate, priced against the CUSTOMER's location -
  // i.e. where this exchange was delivered, so the percent keys off their valley).
  // Done before the delivery txn since the quote runs its own reads.
  let returnCharge = 0;
  if (shouldRaiseReturn && parcel.vendor_id && parcel.destination_location_id) {
    // Same pricing an RTO gets (including a branch flat vendor's inside/outside
    // branch rate). An unpriceable destination or missing rate is a free
    // return rather than blocking the exchange delivery itself.
    returnCharge =
      (await computeReturnCharge(
        parcel.vendors,
        parcel.destination_location_id,
        parcel.weight_kg === null ? null : Number(parcel.weight_kg),
        parcel.service_type,
        parcel.origin_location_id,
      )) ?? 0;
  }

  // A plain RTO (order_type "delivery" bounced back to returned_to_vendor)
  // bills the same discounted return-percent charge a genuine return order
  // gets, instead of the full outbound delivery_charge - see
  // computeReturnCharge. A genuine return order's delivery_charge is already
  // that discounted amount from creation, so this only applies to plain RTO.
  let rtoReturnCharge: number | null = null;
  if (parcel.order_type !== "return" && newStatus === "returned_to_vendor" && parcel.destination_location_id) {
    rtoReturnCharge = await computeReturnCharge(
      parcel.vendors,
      parcel.destination_location_id,
      parcel.weight_kg === null ? null : Number(parcel.weight_kg),
      parcel.service_type,
      parcel.origin_location_id,
    );
  }

  // Reversing a delivery must not silently blow away a COD that's already been
  // swept into a settlement - paid (rider or vendor leg) or still pending.
  // A pending settlement already froze this collection's amount into its
  // settlement_items row at creation time; reversing the collection out from
  // under it would leave that statement showing stale, wrong figures with no
  // record of why. Staff must remove it via the settlement edit flow first.
  // Only the money-reversing case is gated: a partial delivery moving on to
  // follow_up/ready_to_return leaves its collection untouched, so a settlement
  // it already belongs to stays correct and must not be blocked.
  if (isDeliveryReversal) {
    const cod = await prisma.cod_collections.findFirst({
      where: {
        parcel_id: parcelId,
        OR: [{ rider_payment_status: "paid" }, { payment_status: "paid" }, { settlement_items: { some: {} } }],
      },
      select: {
        settlement_items: { select: { settlements: { select: { statement_id: true, payee_type: true } } }, take: 1 },
      },
    });
    if (cod) {
      const stmt = cod.settlement_items[0]?.settlements;
      const reason = stmt ? `is part of ${stmt.payee_type} settlement ${stmt.statement_id}` : "has already been settled";
      throw new AppError(409, `This order's COD ${reason} — resolve that before undelivering.`);
    }
  }

  const updatedParcel = await prisma.$transaction(async (tx) => {
    const updateData: Prisma.parcelsUpdateInput = {
      status: newStatus as parcel_status,
    };
    // Side-effect: re-price a plain RTO's delivery_charge to the discounted
    // return-percent quote computed above, instead of the full outbound rate.
    if (rtoReturnCharge !== null) {
      (updateData as any).delivery_charge = rtoReturnCharge;
    }
    // Side-effect: stamp the pickup time, mirroring delivered_at below. The
    // dashboard's "Picked Up" trend counts parcels by picked_up_at per day, so
    // while nothing set it here the series only ever showed the auto-created
    // return orders, which get the column populated at creation. Routed through
    // pickupStampFor so a forced jump past "picked_up" still leaves the parcel
    // with a pickup time rather than a permanent hole in the trend.
    const pickupStamp = pickupStampFor(newStatus, parcel.picked_up_at);
    if (pickupStamp) {
      (updateData as any).picked_up_at = pickupStamp;
    }
    // Side-effect: set delivered_at timestamp
    if (newStatus === "delivered") {
      (updateData as any).delivered_at = new Date();
    }
    // Side-effect: set delivered_at and store partial delivery data
    if (newStatus === "partially_delivered") {
      (updateData as any).delivered_at = new Date();
      (updateData as any).partial_delivery_remarks = data.remarks || null;
      (updateData as any).partial_cod_collected = data.codCollected ?? 0;
    }
    // Side-effect: the parcel is back off the delivery leg, so it's no longer
    // in that rider's hands. Applies to a partial moving on to follow_up too -
    // that only releases the parcel, never the cash (see below).
    if (leavingDelivery) {
      (updateData as any).delivery_rider_id = null;
    }
    // Side-effect: the parcel is back in the unassigned pickup pool, so the
    // rider who had it no longer has a claim on it (see releasesPickupRider).
    if (releasesPickupRider(newStatus as parcel_status)) {
      (updateData as any).pickup_rider_id = null;
    }
    // Side-effect: retract a completed delivery. It didn't happen, so the
    // delivery timestamp and the COD ledger's "collected" state roll back with
    // it - including cod_collections.rider_id, which is what drops the order
    // off the rider's COD settlement. Guarded above against a collection
    // already swept into a settlement. updateMany, not update: a row should
    // always exist (created at order creation), but a legacy/drifted parcel
    // missing one must not block the status change itself - same reasoning as
    // the delivery upsert below.
    if (isDeliveryReversal) {
      (updateData as any).delivered_at = null;
      (updateData as any).partial_delivery_remarks = null;
      (updateData as any).partial_cod_collected = null;
      // The reversal nulls cod_collections.rider_id, so the parcel must not
      // keep pointing at a rider the money no longer does - delivered ->
      // returned_to_vendor is leavingDelivery=false (both are held), and
      // without this it would leave the rider owning a parcel they were never
      // given. Lands before the assignment below, so a super_admin forcing
      // delivered -> sent_for_delivery with a new rider still wins.
      (updateData as any).delivery_rider_id = null;
      await tx.cod_collections.updateMany({
        where: { parcel_id: parcel.id },
        data: { collected_amount: 0, collected_at: null, rider_id: null },
      });
    }
    // Side-effect: update current_location_id
    if (data.locationId) {
      (updateData as any).current_location_id = data.locationId;
    } else if (currentStatus === "dispatched" && newStatus !== "arrived_at_branch") {
      // Dispatching moves current_location_id straight to the destination hub
      // the moment the parcel leaves (see the mirror of this in
      // _bulkUpdateParcelStatusImpl) - it hasn't physically arrived yet, that's
      // just where it's headed. A force-revert out of dispatched into anything
      // other than the natural arrived_at_branch completion (back to oov, or
      // to hold, or any other correction) undoes that move too: without this,
      // the parcel reads as already sitting at a hub it never reached, and
      // re-dispatching it would start the trip from there instead of from
      // wherever it actually still is.
      const lastDispatch = await tx.dispatch_parcels.findFirst({
        where: { parcel_id: parcelId },
        orderBy: { created_at: "desc" },
        select: { dispatches: { select: { from_location_id: true } } },
      });
      if (lastDispatch?.dispatches.from_location_id) {
        (updateData as any).current_location_id = lastDispatch.dispatches.from_location_id;
      }
    }
    // Side-effect: assign the rider for this leg
    if (riderAssignmentField) {
      (updateData as any)[riderAssignmentField] = data.riderId;
    }
    // Side-effect: each hand-off to a delivery rider counts as one delivery attempt
    if (newStatus === "sent_for_delivery") {
      (updateData as any).attempt_count = { increment: 1 };
    }
    // Side-effect: a hand-off to a delivery rider opens a run sheet
    if (newStatus === "sent_for_delivery" && data.riderId) {
      await createRunSheet(tx, data.riderId, [parcelId], actor.id);
    }
    // Side-effect: tag the COD record with whichever rider is now responsible
    // for collecting it, so rider-scoped COD/finance queries can find it -
    // nothing else in the app ever sets cod_collections.rider_id otherwise.
    if (riderAssignmentField === "delivery_rider_id" && data.riderId) {
      await tx.cod_collections.updateMany({
        where: { parcel_id: parcelId },
        data: { rider_id: data.riderId },
      });
    }
    // Side-effect: record what was actually collected on delivery, so the COD
    // settlement ledger (cod_collections) reflects real cash in hand instead
    // of staying at its order-creation defaults forever. Not gated on a
    // delivery rider being on record - riderId is optional at the transition
    // level (e.g. a super_admin force-transition), and a parcel that skips
    // straight to delivered without one must still enter the settlement
    // ledger or its COD becomes permanently unsettleable.
    if (newStatus === "delivered" || newStatus === "partially_delivered") {
      const collectedAmount = newStatus === "delivered" ? Number(parcel.cod_amount) : (data.codCollected ?? 0);
      // upsert, not update: a cod_collections row should always exist (created
      // atomically at order creation), but this must never block the delivery
      // transition itself if some legacy/drifted parcel is missing one.
      // No collectedAmount > 0 guard here: a COD corrected down to 0 (or a
      // genuine zero-cash partial delivery) must still overwrite whatever
      // stale amount is sitting on the row, or the settlement ledger keeps
      // showing cash that was never actually owed.
      await tx.cod_collections.upsert({
        where: { parcel_id: parcel.id },
        create: {
          parcel_id: parcel.id,
          vendor_id: parcel.vendor_id,
          rider_id: parcel.delivery_rider_id,
          cod_amount: parcel.cod_amount,
          collected_amount: collectedAmount,
          collected_at: new Date(),
        },
        update: {
          rider_id: parcel.delivery_rider_id,
          cod_amount: parcel.cod_amount,
          collected_amount: collectedAmount,
          collected_at: new Date(),
        },
      });
    }
    // Any parcel that finally reaches the vendor needs collected_at stamped so
    // it enters the settlement ledger (getUnsettledOrders) instead of sitting
    // permanently unsettleable - whether it's a genuine return leg (order_type
    // "return", e.g. the auto-created return side of an exchange) or a plain
    // RTO (order_type "delivery" bounced back). Both earn their delivery_charge
    // here - see billing.service.ts's EARNED_CHARGE_SQL.
    if (newStatus === "returned_to_vendor") {
      await tx.cod_collections.update({
        where: { parcel_id: parcel.id },
        data: { collected_at: new Date() },
      });
    }
    // Side-effect: update pickup_task status in sync. pickup_ordered is here
    // for the release case: without it a parcel handed back to the pool leaves
    // its task stuck at rider_assigned/failed_pickup, disagreeing with the
    // parcel it describes.
    if (parcel.pickup_tasks && ["pickup_ordered", "rider_assigned", "picked_up", "cancelled"].includes(newStatus)) {
      await tx.pickup_tasks.update({
        where: { parcel_id: parcel.id },
        data: { status: newStatus as parcel_status },
      });
    }
    // Update the parcel
    const updatedParcel = await tx.parcels.update({
      where: { id: parcelId },
      data: updateData,
    });
    // Write to status history (audit trail)
    await tx.parcel_status_history.create({
      data: {
        parcel_id: parcelId,
        old_status: currentStatus as parcel_status,
        new_status: newStatus as parcel_status,
        location_id: data.locationId || parcel.current_location_id,
        changed_by: actor.id,
        remarks: data.remarks || null,
      },
    });
    // Also surface the reason as a parcel remark - status_history is an audit
    // trail nobody browses day-to-day, but the Remarks thread/column is what
    // vendors and CX actually check, so a failed/cancelled reason typed in
    // the status-change dialog needs to land there too.
    if (data.remarks && data.remarks.trim().length > 0) {
      await tx.parcel_remarks.create({
        data: {
          parcel_id: parcelId,
          user_id: actor.id,
          location_id: data.locationId || parcel.current_location_id,
          remark: `Marked ${newStatus.replace(/_/g, " ")}: ${data.remarks.trim()}`,
        },
      });
    }
    // Write to audit log
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcelId,
        action: "UPDATE_STATUS",
        old_data: { status: currentStatus },
        new_data: { status: newStatus },
      },
    });

    // Mirror of the bulk path's manifest eviction (see its note): a parcel
    // pulled off ready_to_return one at a time - which is exactly how a
    // super_admin correction or a QuickActions change arrives - would otherwise
    // stay a ghost member and deadlock its manifest's send. Manifest sends
    // never come through here, so this needs no returnManifestId exception.
    if (currentStatus === "ready_to_return") {
      await tx.return_manifest_parcels.deleteMany({
        where: { parcel_id: parcelId, return_manifests: { status: "open" } },
      });
    }

    // Same eviction for the transit leg: a parcel pulled off oov (or off the
    // road) one at a time would otherwise stay a ghost member of its manifest.
    if (currentStatus === "oov") {
      await tx.transit_manifest_parcels.deleteMany({
        where: { parcel_id: parcelId, transit_manifests: { status: "open" } },
      });
    }
    if (currentStatus === "dispatched") {
      await tx.transit_manifest_parcels.deleteMany({
        where: { parcel_id: parcelId, transit_manifests: { status: "dispatched" } },
      });
    }

    if (parcel.vendor_id) {
      await emitWebhookEvent(tx, parcel.vendor_id, "order.status_changed", {
        trackingId: parcel.tracking_id,
        orderId: parcel.id,
        vendorId: parcel.vendor_id,
        oldStatus: currentStatus,
        newStatus,
        changedAt: new Date().toISOString(),
      });
    }

    // Side-effect: a confirmed exchange delivery hands the customer's return
    // parcel to the rider. Auto-create that return order (customer → vendor,
    // no COD, return-rate charge), already picked up by this delivery rider,
    // and link it back to the exchange order. Guarded so a re-delivery of the
    // same exchange (e.g. super_admin override) can't create a duplicate.
    if (shouldRaiseReturn) {
      const existingReturn = await tx.parcels.findFirst({
        where: { source_order_id: parcel.id },
        select: { id: true },
      });
      if (!existingReturn) {
        const returnTrackingId = await generateUniqueTrackingId(tx);
        const customerParty = parcel.parties_parcels_receiver_idToparties;
        const vendorParty = parcel.parties_parcels_sender_idToparties;
        const now = new Date();
        // The return leg starts at the hub that ran this delivery - where the
        // rider carrying it back reports - which is current_location_id, not
        // destination_location_id. The latter is the customer's delivery zone
        // (e.g. "INSIDE VALLEY - KTM"), a top-level location no hub covers, so
        // using it left the return invisible to every branch-scoped admin
        // (branchHandlesFilter matches origin/current against hub coverage) and
        // made any later transit stage or reprice key off a non-hub origin.
        const returnHubId = parcel.current_location_id ?? parcel.destination_location_id;
        const ret = await tx.parcels.create({
          data: {
            tracking_id: returnTrackingId,
            search_text: buildSearchText(returnTrackingId, customerParty, vendorParty),
            vendor_id: parcel.vendor_id,
            // Goods flow customer → vendor: swap the exchange order's parties/route.
            sender_id: parcel.receiver_id,
            receiver_id: parcel.sender_id,
            origin_location_id: returnHubId,
            current_location_id: returnHubId,
            destination_location_id: parcel.origin_location_id,
            order_type: "return",
            service_type: parcel.service_type,
            status: "picked_up",
            pieces: parcel.pieces,
            weight_kg: parcel.weight_kg,
            cod_amount: 0,
            delivery_charge: returnCharge,
            source_order_id: parcel.id,
            pickup_rider_id: parcel.delivery_rider_id,
            picked_up_at: now,
            created_by: actor.id,
          },
        });
        // Sequential, not Promise.all: tx is one Postgres connection, so
        // "concurrent" queries against it just pipeline on that client - pg
        // now deprecates that (removed in pg@9). Same cost, awaited one at a time.
        await tx.cod_collections.create({
          data: { parcel_id: ret.id, vendor_id: parcel.vendor_id, cod_amount: 0, payment_status: "pending" },
        });
        await tx.pickup_tasks.create({
          data: { parcel_id: ret.id, pickup_address: null, status: "picked_up" },
        });
        await tx.parcel_status_history.create({
          data: {
            parcel_id: ret.id,
            old_status: null,
            new_status: "picked_up",
            location_id: parcel.destination_location_id,
            changed_by: actor.id,
            remarks: `Return auto-created from exchange order ${parcel.tracking_id}`,
          },
        });
        await tx.audit_logs.create({
          data: {
            actor_id: actor.id,
            entity_type: "parcel",
            entity_id: ret.id,
            action: "CREATE_RETURN_ORDER",
            new_data: { trackingId: ret.tracking_id, sourceOrderId: parcel.id, sourceTrackingId: parcel.tracking_id },
          },
        });
      }
    }

    return updatedParcel;
  });

  await invalidateOrderCaches();

  // Reversing a delivery rewrites cod_collections, which the finance caches
  // (pending COD, unsettled orders, per-rider statements) are built from -
  // invalidateOrderCaches only covers the dashboard/orders-list namespaces, so
  // without this the rider's settlement list keeps serving the undelivered
  // order until the TTL lapses. Best-effort: a Redis hiccup must not fail an
  // already-committed status change.
  if (isDeliveryReversal) {
    if (parcel.vendor_id) {
      invalidateVendorFinanceCache(parcel.vendor_id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
    }
    if (parcel.delivery_rider_id) {
      invalidateRiderFinanceCache(parcel.delivery_rider_id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
    }
  }

  // A delivery (or an un-delivery) is what moves a vendor's account balance, so
  // it's the moment to re-check whether they've crossed a credit threshold.
  // Fire-and-forget: a billing notification must never fail the status change.
  if (statusAffectsBalance(newStatus) || statusAffectsBalance(parcel.status)) {
    evaluateVendorBillingAsync(parcel.vendor_id);
  }

  // Notify the vendor when pickup or delivery fails — these are actionable
  // events the vendor needs to respond to (re-schedule, contact customer, etc.).
  if (newStatus === "failed_pickup") {
    notifyVendorOfParcel(
      parcel.vendor_id,
      `Pickup Failed: ${parcel.tracking_id}`,
      data.remarks || "Pickup attempt failed",
      parcel.tracking_id,
      "pickup_failed",
      `/orders/track/${parcel.tracking_id}`,
    ).catch(() => {});
  } else if (newStatus === "failed_delivery") {
    notifyVendorOfParcel(
      parcel.vendor_id,
      `Delivery Failed: ${parcel.tracking_id}`,
      data.remarks || "Delivery attempt failed",
      parcel.tracking_id,
      "delivery_failed",
      `/orders/track/${parcel.tracking_id}`,
    ).catch(() => {});
  }

  // Failed pickup/delivery and cancellation are exceptional, actionable
  // events for the vendor (unlike routine transit pings), so - like the
  // auto-raised return above - this is worth an exception to the
  // no-blanket-status-notifications rule.
  if (REASON_REQUIRED_STATUSES.includes(newStatus as parcel_status)) {
    const vendorUserId = parcel.vendors?.user_id;
    if (vendorUserId && vendorUserId !== actor.id) {
      createNotification(
        vendorUserId,
        `Order ${parcel.tracking_id} marked ${newStatus.replace(/_/g, " ")}`,
        data.remarks || null,
        parcel.tracking_id,
        "status_change",
        `/orders/track/${parcel.tracking_id}`,
      ).catch(() => {});
    }
  }

  return updatedParcel;
}
