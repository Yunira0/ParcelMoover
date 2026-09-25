import { parcel_status } from "../../generated/prisma/client";
import type { ParcelStatus } from "../../types/order.type";
import { AppError } from "../../utils/AppError";
import { DELIVERY_LEG_STATUSES, PICKUP_LEG_STATUSES } from "./scope";

// The admin overview divides the pipeline into disjoint operational stages.
export const PICKUP_PENDING_STATUSES: parcel_status[] = [
  "pickup_ordered",
  "rider_assigned",
  "picked_up",
  "arrived",
];

export const IN_TRANSIT_STATUSES: parcel_status[] = [
  "dispatched",
  "oov",
];

export const RETURN_PENDING_STATUSES: parcel_status[] = [
  "follow_up",
  "ready_to_return",
  "sent_to_vendor",
];

export const DELIVERY_PENDING_STATUSES: parcel_status[] = [
  "arrived_at_branch",
  "ready_to_deliver",
  "sent_for_delivery",
  "failed_delivery",
];

// Vendor and sales overview buckets intentionally differ from admin buckets:
// pending pickup ends when we physically take the parcel, then every stage
// through delivery is one in-progress bucket. Keep these in step with the
// client VendorMetricDetail list behind that card.
export const AWAITING_PICKUP_STATUSES: parcel_status[] = ["pickup_ordered", "rider_assigned"];

export const IN_DELIVERY_STATUSES: parcel_status[] = [
  "picked_up",
  "arrived",
  "oov",
  "dispatched",
  "arrived_at_branch",
  "ready_to_deliver",
  "sent_for_delivery",
];

export const HUB_OPERATION_STATUSES: parcel_status[] = ["arrived", "dispatched", "arrived_at_branch"];

export const RETURN_WORKFLOW_STATUSES: parcel_status[] = [
  "follow_up",
  "ready_to_return",
  "sent_to_vendor",
  "returned_to_vendor",
];

export const TERMINAL_STATUSES: parcel_status[] = [
  "delivered",
  "cancelled",
  "returned_to_vendor",
];

// Both statuses mean the rider handed goods over and collected customer cash.
// They stamp the COD ledger in the single and bulk status paths.
export const DELIVERY_STATUSES: parcel_status[] = ["delivered", "partially_delivered"];

export const OPS_RESTRICTED_STATUSES: parcel_status[] = ["hold", "loss_and_damage"];

export const POST_PICKUP_STATUSES: parcel_status[] = [
  "picked_up",
  "arrived",
  "ready_to_deliver",
  "sent_for_delivery",
  "oov",
  "dispatched",
  "arrived_at_branch",
  "hold",
  "loss_and_damage",
  "delivered",
  "partially_delivered",
  "failed_delivery",
  "follow_up",
  "ready_to_return",
  "sent_to_vendor",
  "returned_to_vendor",
];

/**
 * Re-pickup gets a fresh timestamp. Later stages fill a missing timestamp only,
 * because super admins can skip picked_up without losing the pickup trend, but
 * ordinary progress must never overwrite the actual handover time.
 */
export function pickupStampFor(
  newStatus: parcel_status | ParcelStatus,
  currentPickedUpAt: Date | null,
): Date | null {
  if (newStatus === "picked_up") return new Date();
  if (currentPickedUpAt !== null) return null;
  return POST_PICKUP_STATUSES.includes(newStatus as parcel_status) ? new Date() : null;
}

// Nearby areas outside the location table's valley boundary can go directly
// from origin arrival to delivery without an unnecessary Transit leg.
export const DIRECT_DELIVERY_FRINGE_AREAS = ["kavresthali", "thali", "chapagaun", "budhanilkantha", "thankot"];

export function destinationSkipsTransit(destination: { valley?: string | null; name?: string | null } | null | undefined): boolean {
  if (!destination) return false;
  if (destination.valley === "inside") return true;
  const name = (destination.name ?? "").toLowerCase();
  return DIRECT_DELIVERY_FRINGE_AREAS.some((area) => name.includes(area));
}

export const RIDER_ASSIGNMENT_FIELD: Partial<Record<parcel_status, "pickup_rider_id" | "delivery_rider_id">> = {
  rider_assigned: "pickup_rider_id",
  sent_for_delivery: "delivery_rider_id",
  sent_to_vendor: "delivery_rider_id",
};

export const REASON_REQUIRED_STATUSES: parcel_status[] = [
  "cancelled",
  "failed_pickup",
  "failed_delivery",
];

// A delivery rider retains a claim on these stages, including completed
// deliveries for COD attribution and a return they carried to the vendor.
// ready_to_deliver is excluded: the parcel is in the pool for a rider.
export const DELIVERY_RIDER_HELD_STATUSES: parcel_status[] = [
  "sent_for_delivery",
  "failed_delivery",
  "delivered",
  "partially_delivered",
  "sent_to_vendor",
  "returned_to_vendor",
];

// Returning to the pickup pool clears the old claim. Do not clear it at hub
// arrival: history, rider counts, and finance still need to know who collected.
export function releasesPickupRider(newStatus: parcel_status): boolean {
  return newStatus === "pickup_ordered";
}

export function assertRiderOwnsLeg(
  currentStatus: parcel_status,
  parcel: { pickup_rider_id: string | null; delivery_rider_id: string | null },
  actorRiderId: string,
): void {
  if (PICKUP_LEG_STATUSES.includes(currentStatus)) {
    if (parcel.pickup_rider_id !== actorRiderId) {
      throw new AppError(403, "You are not the assigned pickup rider for this parcel");
    }
    return;
  }
  if (DELIVERY_LEG_STATUSES.includes(currentStatus)) {
    if (parcel.delivery_rider_id !== actorRiderId) {
      throw new AppError(403, "You are not the assigned delivery rider for this parcel");
    }
    return;
  }
  throw new AppError(403, "Riders cannot update this parcel from its current status");
}

export const isUndelivering = (from: parcel_status, to: string) =>
  DELIVERY_STATUSES.includes(from) && !DELIVERY_STATUSES.includes(to as parcel_status);
