import { parcel_status, Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { evaluateVendorBillingAsync } from "../billing.service";
import { invalidateVendorFinanceCache } from "../finance.service";
import { emitWebhookEvent } from "../webhookDispatch.service";
import { invalidateOrderCaches } from "./cache";
import { pickupStampFor } from "./status-shared";
import { withParcelStatusLocks } from "./statusLocks";

// ── External-carrier (3PL) status updates ────────────────────────────────────

// The outside-valley leg a 3PL carrier drives on our behalf, in lifecycle
// order. Carrier events may only move a parcel *forward* along this sequence;
// anything else (duplicates, out-of-order webhooks, a parcel that ops moved to
// hold/loss_and_damage in the meantime) is skipped rather than fought.
const CARRIER_LEG_SEQUENCE: parcel_status[] = [
  "oov",
  "dispatched",
  "arrived_at_branch",
  "sent_for_delivery",
  "delivered",
];

export type CarrierStatusResult = { applied: boolean; reason?: string };

/**
 * Applies a status reported by an external carrier (webhook/reconciliation).
 * Deliberately bypasses the actor-driven transition machinery: there is no
 * internal rider, run sheet, or dispatch manifest on a 3PL-carried leg, so
 * this writes the parcel status + history/audit rows directly, under the same
 * per-parcel lock the normal paths use.
 */
export async function applyExternalCarrierStatus(
  parcelId: string,
  targetStatus: parcel_status,
  remarks: string,
): Promise<CarrierStatusResult> {
  return withParcelStatusLocks([parcelId], async (): Promise<CarrierStatusResult> => {
    const parcel = await prisma.parcels.findFirst({
      where: { id: parcelId, deleted_at: null },
    });
    if (!parcel) return { applied: false, reason: "Parcel not found" };

    const targetIdx = CARRIER_LEG_SEQUENCE.indexOf(targetStatus);
    if (targetIdx === -1) {
      return { applied: false, reason: `'${targetStatus}' is not a carrier-leg status` };
    }
    const currentIdx = CARRIER_LEG_SEQUENCE.indexOf(parcel.status);
    if (currentIdx === -1) {
      return { applied: false, reason: `Parcel is '${parcel.status}', not on the carrier leg` };
    }
    if (targetIdx <= currentIdx) {
      return { applied: false, reason: `Parcel is already '${parcel.status}'` };
    }

    // A real employee still attached to a parcel the carrier is now moving is
    // a stale claim (see the release below); a carrier placeholder rider is
    // not. Resolved once, up front, so both the parcel write and the COD
    // attribution below agree on which rider - if any - still owns this leg.
    const attachedRider = parcel.delivery_rider_id
      ? await prisma.riders.findUnique({
          where: { id: parcel.delivery_rider_id },
          select: { carrier_code: true },
        })
      : null;
    const releasedRiderId = attachedRider && !attachedRider.carrier_code
      ? parcel.delivery_rider_id
      : null;
    const effectiveRiderId = releasedRiderId ? null : parcel.delivery_rider_id;

    await prisma.$transaction(async (tx) => {
      const updateData: Prisma.parcelsUpdateInput = { status: targetStatus };
      // CARRIER_LEG_SEQUENCE starts at "oov", so targetStatus can never be
      // "picked_up" here and the equality check this replaces was unreachable.
      // A carrier leg still implies the parcel left the sender, so stamp it if
      // nothing on the internal flow did.
      const pickupStamp = pickupStampFor(targetStatus, parcel.picked_up_at);
      if (pickupStamp) {
        (updateData as any).picked_up_at = pickupStamp;
      }
      if (targetStatus === "delivered") {
        (updateData as any).delivered_at = new Date();
      }
      // Side-effect: the internal release rule (leavingDelivery) never runs
      // here, because this function deliberately bypasses the actor-driven
      // machinery - so a real employee left on delivery_rider_id by an earlier
      // internal attempt survives onto the carrier leg. That has to be cleared:
      // the delivered upsert below writes cod_collections.rider_id from this
      // very column, so leaving it hands the carrier's collected cash to a
      // rider who never touched it.
      //
      // Only real employees, though. A placeholder rider standing in for the
      // carrier itself ("PM Rider N"/"PM Rider U", carrier_code non-null) is a
      // deliberate manual routing and is what the finance queries read to
      // attribute the cash to that carrier - see cod_from_ncm/cod_from_upaya.
      if (releasedRiderId) {
        (updateData as any).delivery_rider_id = null;
      }
      await tx.parcels.update({ where: { id: parcelId }, data: updateData });
      // A carrier delivery collects the COD just as an in-house rider does -
      // without this the ledger stays at its order-creation default, and the
      // parcel never becomes settleable to the vendor (both unsettled queries
      // require collected_at IS NOT NULL).
      //
      // No cod_amount > 0 guard, matching the in-house paths: a zero-COD
      // delivery still owes its delivery charge, so it has to enter the ledger
      // (settling at a negative net payable) rather than sit permanently
      // unsettleable and never bill that charge.
      //
      // rider_id is whichever rider legitimately still owns this leg, which is
      // null for a real employee (released above, so their COD settlement is
      // not credited with cash they never carried) and the carrier placeholder
      // where one is routing the parcel - that is what cod_from_ncm /
      // cod_from_upaya read to attribute the cash to the carrier.
      if (targetStatus === "delivered") {
        await tx.cod_collections.upsert({
          where: { parcel_id: parcelId },
          create: {
            parcel_id: parcelId,
            vendor_id: parcel.vendor_id,
            rider_id: effectiveRiderId,
            cod_amount: parcel.cod_amount,
            collected_amount: parcel.cod_amount,
            collected_at: new Date(),
          },
          update: {
            // rider_id is rewritten, not left alone: an earlier internal
            // delivery attempt may have stamped a rider on this collection,
            // and a 3PL carrier delivering it must not leave that rider owing
            // cash they never touched. NULL here is what makes the finance
            // queries read this as carrier-collected (see cod_from_ncm) - and
            // effectiveRiderId, not the raw column, is what guarantees NULL
            // even when a stale employee rider was still attached on arrival.
            rider_id: effectiveRiderId,
            cod_amount: parcel.cod_amount,
            collected_amount: parcel.cod_amount,
            collected_at: new Date(),
          },
        });
      }
      await tx.parcel_status_history.create({
        data: {
          parcel_id: parcelId,
          old_status: parcel.status,
          new_status: targetStatus,
          location_id: parcel.current_location_id,
          changed_by: null,
          remarks,
        },
      });
      await tx.audit_logs.create({
        data: {
          actor_id: null,
          entity_type: "parcel",
          entity_id: parcelId,
          action: "CARRIER_UPDATE_STATUS",
          old_data: { status: parcel.status },
          new_data: { status: targetStatus, remarks },
        },
      });

      if (parcel.vendor_id) {
        await emitWebhookEvent(tx, parcel.vendor_id, "order.status_changed", {
          trackingId: parcel.tracking_id,
          orderId: parcel.id,
          vendorId: parcel.vendor_id,
          oldStatus: parcel.status,
          newStatus: targetStatus,
          changedAt: new Date().toISOString(),
        });
      }

    });

    await invalidateOrderCaches();
    if (targetStatus === "delivered" && parcel.vendor_id) {
      invalidateVendorFinanceCache(parcel.vendor_id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
      evaluateVendorBillingAsync(parcel.vendor_id);
    }
    return { applied: true };
  });
}

// A 3PL (NCM) marking an order "Sent to Vendor" means it's coming back to
// *us*, not to the client vendor - that's our own follow_up review stage, not
// our "sent_to_vendor" status (which means an internal rider carrying it to
// the client vendor). This is a one-way exit from the carrier leg, not a
// further step along CARRIER_LEG_SEQUENCE, so it's a separate small function
// rather than an extension of applyExternalCarrierStatus's monotonic check.
const CARRIER_FOLLOW_UP_ELIGIBLE_STATUSES: parcel_status[] = [
  "oov",
  "dispatched",
  "arrived_at_branch",
  "sent_for_delivery",
];

/**
 * Applies an external-carrier-initiated return (NCM's "Sent to Vendor") by
 * exiting the carrier leg into our own follow_up stage. From there ops runs
 * the normal, unmodified Return-to-Origin ladder with a real internal rider.
 */
export async function applyExternalCarrierFollowUp(
  parcelId: string,
  remarks: string,
): Promise<CarrierStatusResult> {
  return withParcelStatusLocks([parcelId], async (): Promise<CarrierStatusResult> => {
    const parcel = await prisma.parcels.findFirst({
      where: { id: parcelId, deleted_at: null },
    });
    if (!parcel) return { applied: false, reason: "Parcel not found" };

    if (!CARRIER_FOLLOW_UP_ELIGIBLE_STATUSES.includes(parcel.status)) {
      return { applied: false, reason: `Parcel is '${parcel.status}', not on the carrier leg` };
    }

    await prisma.$transaction(async (tx) => {
      // follow_up is not a delivery-held status, so the parcel is back with
      // ops and no rider has a claim on it. This path bypasses the internal
      // release (leavingDelivery) the same way applyExternalCarrierStatus
      // does, and it is reachable straight from sent_for_delivery - without
      // this, a rider whose delivery attempt the carrier took over keeps the
      // parcel in their app forever, with no action available on it.
      await tx.parcels.update({
        where: { id: parcelId },
        data: { status: "follow_up", delivery_rider_id: null },
      });
      await tx.parcel_status_history.create({
        data: {
          parcel_id: parcelId,
          old_status: parcel.status,
          new_status: "follow_up",
          location_id: parcel.current_location_id,
          changed_by: null,
          remarks,
        },
      });
      await tx.audit_logs.create({
        data: {
          actor_id: null,
          entity_type: "parcel",
          entity_id: parcelId,
          action: "CARRIER_UPDATE_STATUS",
          old_data: { status: parcel.status },
          new_data: { status: "follow_up", remarks },
        },
      });

      if (parcel.vendor_id) {
        await emitWebhookEvent(tx, parcel.vendor_id, "order.status_changed", {
          trackingId: parcel.tracking_id,
          orderId: parcel.id,
          vendorId: parcel.vendor_id,
          oldStatus: parcel.status,
          newStatus: "follow_up",
          changedAt: new Date().toISOString(),
        });
      }
    });

    await invalidateOrderCaches();
    return { applied: true };
  });
}
