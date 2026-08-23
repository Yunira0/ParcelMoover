import { parcel_status, Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import redis, { scanAndDelete } from "../lib/redis";
import { AppError } from "../utils/AppError";
import { getSlaSettings, SLA_GROUPS } from "./sla.service";
import { unclosedRemarksWhere } from "./remark.service";
import {
  BulkCreateOrderInput,
  BulkUpdateParcelStatusInput,
  CreateOrderInput,
  ListOrdersQuery,
  OrderPartyInput,
  OrderSortField,
  ParcelStatus,
  RedirectOrderInput,
  STATUS_TRANSITIONS,
  UpdateOrderDetailsInput,
  UpdateParcelStatusInput,
} from "../types/order.type";
import { generateTrackingId } from "../utils/trackingId";
import { generateDispatchNo } from "../utils/dispatchId";
import { generateRunSheetNo } from "../utils/runSheetNo";
import {
  NEPAL_UTC_OFFSET_MS,
  formatNepalDate as formatDate,
  nepalDayRangeUtc,
} from "../utils/nepalTime";
import { resolveOwnVendorId, isStaffActor } from "./vendor-scope.service";
import { hasAdminPermission } from "../middlewares/adminPermission.middleware";
import { invalidateVendorFinanceCache, invalidateRiderFinanceCache } from "./finance.service";
import { emitWebhookEvent, emitWebhookEventsBatch } from "./webhookDispatch.service";
import { getVendorStatusLabel } from "../utils/orderStatusLabel";
import { displayAuthor, displayRemarkText, stripCarrierStaffTag } from "../utils/carrierRemark";
import {
  assertVendorCanCreateOrder,
  evaluateVendorBillingAsync,
  evaluateVendorsBillingAsync,
  statusAffectsBalance,
} from "./billing.service";

type Party = { name: string; phone: string; alternate_phone?: string | null };
function buildSearchText(trackingId: string, sender: Party, receiver: Party): string {
  return [
    trackingId,
    sender.name, sender.phone, sender.alternate_phone ?? "",
    receiver.name, receiver.phone, receiver.alternate_phone ?? "",
  ].join(" ").toLowerCase();
}

// The list UI labels every row with its order_number as "#2980", so that's what
// a user types to look one up. order_number is an int column, not part of the
// search_text trigram blob, so it needs its own equality match.
// Capped at 9 digits to stay inside int4 - a longer run of digits is a phone
// number, and passing it to Prisma as an Int would throw.
const ORDER_NUMBER_TERM = /^#?(\d{1,9})$/;
function parseOrderNumber(term: string): number | null {
  const match = ORDER_NUMBER_TERM.exec(term);
  return match ? Number(match[1]) : null;
}

import { getDeliveryQuote } from "./delivery-rate.service";
import { getVendorQuote, getReturnDeliveryQuote, RateType, ServiceType } from "./pricing.service";
import { resolveLabelSize } from "./vendorPrintSettings.service";
import { HANDOFF_REMARK_PREFIX as NCM_HANDOFF_REMARK_PREFIX } from "./ncm.service";
import { HANDOFF_REMARK_PREFIX as UPAYA_HANDOFF_REMARK_PREFIX } from "./upaya.service";

// Maps a vendor row's branch-rate override columns to VendorRateOverrides keys.
function branchOverrides(v: {
  branch_flat_inside_valley: unknown; branch_flat_outside_valley: unknown;
  branch_zone_major_cities: unknown; branch_zone_urban_areas: unknown;
  branch_zone_remote_areas: unknown; branch_zone_inside_valley: unknown;
}) {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    branchFlatInsideValley: n(v.branch_flat_inside_valley),
    branchFlatOutsideValley: n(v.branch_flat_outside_valley),
    branchZoneMajorCities: n(v.branch_zone_major_cities),
    branchZoneUrbanAreas: n(v.branch_zone_urban_areas),
    branchZoneRemoteAreas: n(v.branch_zone_remote_areas),
    branchZoneInsideValley: n(v.branch_zone_inside_valley),
  };
}
import { createNotification } from "./notification.service";

// Prices a parcel's return-to-vendor charge as the vendor's return percent of
// the normal rate for that destination/weight - the same discounted quote a
// genuine order_type "return" parcel is priced at from creation (see
// getReturnDeliveryQuote). Used to re-price a plain RTO (a normal delivery
// that failed and bounced back) once it actually reaches the vendor, so both
// paths bill consistently instead of a plain RTO charging the full outbound
// rate. Returns null (leave the existing charge alone) if the quote can't be
// computed, e.g. an unclassified destination.
export async function computeReturnCharge(
  vendor: {
    rate_type: string | null;
    flat_inside_valley: unknown; flat_outside_valley: unknown;
    zone_major_cities: unknown; zone_urban_areas: unknown; zone_remote_areas: unknown; zone_inside_valley: unknown;
    inside_valley_flat_rate: unknown; extra_weight_percent: unknown;
    return_inside_valley_percent: unknown; return_outside_valley_percent: unknown;
    branch_flat_inside_valley: unknown; branch_flat_outside_valley: unknown;
    branch_zone_major_cities: unknown; branch_zone_urban_areas: unknown;
    branch_zone_remote_areas: unknown; branch_zone_inside_valley: unknown;
  } | null | undefined,
  destinationLocationId: string,
  weightKg: number | null,
  serviceType: string,
): Promise<number | null> {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  try {
    const quote = await getReturnDeliveryQuote(
      (vendor?.rate_type as RateType) ?? "flat",
      destinationLocationId,
      weightKg === null ? 1 : weightKg,
      vendor
        ? {
            flatInsideValley: n(vendor.flat_inside_valley),
            flatOutsideValley: n(vendor.flat_outside_valley),
            zoneMajorCities: n(vendor.zone_major_cities),
            zoneUrbanAreas: n(vendor.zone_urban_areas),
            zoneRemoteAreas: n(vendor.zone_remote_areas),
            zoneInsideValley: n(vendor.zone_inside_valley),
            insideValleyFlatRate: n(vendor.inside_valley_flat_rate),
            extraWeightPercent: n(vendor.extra_weight_percent),
            ...branchOverrides(vendor),
            returnInsideValleyPercent: n(vendor.return_inside_valley_percent),
            returnOutsideValleyPercent: n(vendor.return_outside_valley_percent),
          }
        : {},
      serviceType as ServiceType,
    );
    return quote.totalPayable;
  } catch {
    return null;
  }
}

type OrderActor = {
  id: string;
  roles: string[];
};

const MAX_TRACKING_ID_RETRIES = 5;

// The "Pending pickups" overview card: parcels awaiting pickup or in the
// pickup/origin phase before they are dispatched onward (picked up at origin,
// arrived at the origin branch).
const PICKUP_PENDING_STATUSES: parcel_status[] = [
  "pickup_ordered",
  "rider_assigned",
  "picked_up",
  "arrived",
];

// The "In transit" overview card: parcels dispatched and moving between
// branches (dispatched) or out on the OOV leg (oov).
const IN_TRANSIT_STATUSES: parcel_status[] = [
  "dispatched",
  "oov",
];

// The "Pending returns" overview card: parcels in the return flow that haven't
// been handed back yet - flagged for follow up, ready to return, or already
// sent to the vendor (returned_to_vendor is terminal and excluded).
const RETURN_PENDING_STATUSES: parcel_status[] = [
  "follow_up",
  "ready_to_return",
  "sent_to_vendor",
];

// The "Pending deliveries" overview card: parcels that have reached the
// destination and are in the delivery flow - arrived at destination, ready to
// deliver, sent out for delivery, or a failed attempt awaiting reattempt.
// Kept disjoint from IN_TRANSIT_STATUSES so a parcel is counted in exactly one.
const DELIVERY_PENDING_STATUSES: parcel_status[] = [
  "arrived_at_branch",
  "ready_to_deliver",
  "sent_for_delivery",
  "failed_delivery",
];

// The vendor/sales overview cards split the pipeline differently from the
// admin dashboard: a vendor only calls a parcel "pending pickup" until we
// physically take it, and everything after that is one "in progress" bucket
// all the way to the customer's door. The admin cards instead split that span
// into pending-pickups / in-transit / pending-deliveries by hub stage. Both
// views are legitimate, so they get their own counters rather than one being
// bent to fit the other - these two must stay in step with IN_DELIVERY_STATUSES
// in the client's VendorMetricDetail, which lists the orders behind the card.
const AWAITING_PICKUP_STATUSES: parcel_status[] = ["pickup_ordered", "rider_assigned"];

const IN_DELIVERY_STATUSES: parcel_status[] = [
  "picked_up",
  "arrived",
  "oov",
  "dispatched",
  "arrived_at_branch",
  "ready_to_deliver",
  "sent_for_delivery",
];

// Hub-level transitions: confirming hub arrival and building/closing a
// dispatch manifest are branch operations for admin/hub staff to perform,
// not something the picking-up rider should be able to trigger themselves.
const HUB_OPERATION_STATUSES: parcel_status[] = ["arrived", "dispatched", "arrived_at_branch"];

// Return-to-Origin workflow stages — staff-only, driven from Return Operations.
const RETURN_WORKFLOW_STATUSES: parcel_status[] = [
  "follow_up",
  "ready_to_return",
  "sent_to_vendor",
  "returned_to_vendor",
];

const TERMINAL_STATUSES: parcel_status[] = [
  "delivered",
  "cancelled",
  "returned_to_vendor",
];

// The two statuses that mean "the rider handed the parcel over and took the
// customer's cash" - i.e. the ones that stamp the COD ledger (see the
// cod_collections upserts in updateParcelStatus / bulkUpdateParcelStatus).
const DELIVERY_STATUSES: parcel_status[] = ["delivered", "partially_delivered"];

// Hold / Loss & Damage are only reachable from the ops dashboard's dedicated
// pages (HoldOperations / LossAndDamageOperations), both admin-gated in the
// UI — the API must enforce the same restriction, not just hide the buttons.
const OPS_RESTRICTED_STATUSES: parcel_status[] = ["hold", "loss_and_damage"];

// Statuses a parcel can only be in once it has physically been picked up -
// every status except the two pre-pickup ones (pickup_ordered, rider_assigned)
// and the two that mean the pickup never happened (failed_pickup, cancelled).
// Needed because "picked_up" is skippable: a super_admin may force any
// transition from any status (see the isSuperAdmin bypasses below), so a parcel
// can land on "delivered" having never passed through "picked_up". Without a
// stamp on those the dashboard's "Picked Up" trend loses them permanently.
const POST_PICKUP_STATUSES: parcel_status[] = [
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
 * The picked_up_at value to write for a transition into `newStatus`, or null to
 * leave the column alone.
 *
 * The real pickup transition always re-stamps, so a forced re-pickup records
 * when the goods actually left the sender this time round. Every other
 * post-pickup status stamps only while the column is still null - that is the
 * skip path, and scoping it to null means it can neither overwrite a genuine
 * pickup time nor fire at all on the normal flow.
 */
function pickupStampFor(
  newStatus: parcel_status | ParcelStatus,
  currentPickedUpAt: Date | null,
): Date | null {
  if (newStatus === "picked_up") return new Date();
  if (currentPickedUpAt !== null) return null;
  return POST_PICKUP_STATUSES.includes(newStatus as parcel_status) ? new Date() : null;
}

// Fringe areas that sit just outside the valley boundary in `locations.valley`
// but are close enough to be delivered directly from origin without a Transit
// (OOV) leg — routing them through Transit anyway would just add a redundant
// hop for a same-day-reachable destination.
const DIRECT_DELIVERY_FRINGE_AREAS = ["kavresthali", "thali", "chapagaun", "budhanilkantha", "thankot"];

// From "arrived" (Arrived at Origin), whether a parcel can go straight to
// Ready to Deliver (true) or must go to Transit/OOV first (false), based on
// its destination. Inside-valley destinations, plus the fringe areas above,
// skip Transit; everything else needs the OOV leg.
function destinationSkipsTransit(destination: { valley?: string | null; name?: string | null } | null | undefined): boolean {
  if (!destination) return false;
  if (destination.valley === "inside") return true;
  const name = (destination.name ?? "").toLowerCase();
  return DIRECT_DELIVERY_FRINGE_AREAS.some((area) => name.includes(area));
}

// Raised from 100 so the order lists can offer a 500-row page — scanning a
// day's parcels in one screen beats paging through five. An order row is
// expensive (ORDERS_INCLUDE pulls nine relations, one nested three deep), but
// Prisma batches per relation rather than per row, so the cost stays linear.
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 10;
const MAX_BULK_IDS = 200;

const DASHBOARD_SUMMARY_CACHE_PREFIX = "dashboard:summary:";
const DASHBOARD_SUMMARY_TTL_SECONDS = 30;

const ORDERS_LIST_CACHE_PREFIX = "orders:list:";
const ORDERS_LIST_TTL_SECONDS = 20;

function dashboardSummaryCacheKey(vendorId?: string, riderId?: string, trendDays: 7 | 30 = 7) {
  return `${DASHBOARD_SUMMARY_CACHE_PREFIX}${vendorId ?? "none"}:${riderId ?? "none"}:${trendDays}d`;
}

// Sales accounts are scoped to the set of vendors (clients) they own rather
// than a single vendor/rider id. Keying on the sorted id set is still safe
// to share: two sales accounts only ever collide on this key if they own
// the exact same client list, in which case sharing the cached result is
// correct, not a leak.
function salesDashboardSummaryCacheKey(vendorIds: string[], trendDays: 7 | 30 = 7) {
  return `${DASHBOARD_SUMMARY_CACHE_PREFIX}sales:${vendorIds.slice().sort().join(",")}:${trendDays}d`;
}

// Coalesces concurrent cache-miss computations that share a cache key so a
// burst of requests hitting the same expired entry (e.g. thousands of users
// backed by the same few hundred accounts, all polling on a similar cycle)
// triggers the expensive aggregation once instead of once per request. Each
// dashboard-summary miss fans out into ~17 queries - without this, a stampede
// of simultaneous misses is what exhausts the DB connection pool, not the
// steady-state read rate.
const inFlightComputations = new Map<string, Promise<unknown>>();

async function dedupeInFlight<T>(key: string | null, compute: () => Promise<T>): Promise<T> {
  if (!key) return compute();

  const existing = inFlightComputations.get(key);
  if (existing) return existing as Promise<T>;

  const promise = compute().finally(() => {
    inFlightComputations.delete(key);
  });
  inFlightComputations.set(key, promise);
  return promise;
}

// Only the default, unfiltered/unpaginated listOrders() call is cached, so the
// scope (vendor/rider) is all that distinguishes one cached list from another.
function ordersListCacheKey(vendorId?: string, riderId?: string) {
  return `${ORDERS_LIST_CACHE_PREFIX}${vendorId ?? "none"}:${riderId ?? "none"}`;
}

// Best-effort: a Redis hiccup should never block a status update or fall
// back to a 503 - the dashboard/list just serve a stale value until the TTL expires.
export async function invalidateOrderCaches() {
  try {
    await Promise.all([
      scanAndDelete(`${DASHBOARD_SUMMARY_CACHE_PREFIX}*`),
      scanAndDelete(`${ORDERS_LIST_CACHE_PREFIX}*`),
    ]);
  } catch (error) {
    console.error("[Redis] Failed to invalidate order caches:", error);
  }
}

const PARCEL_STATUS_LOCK_PREFIX = "parcel-status-lock:";
const PARCEL_STATUS_LOCK_TTL_SECONDS = 15;

// Guards against two concurrent status-change requests for the same parcel(s)
// both reading the same "current status" and both passing transition
// validation before either commits (a double-click, or two staff acting at
// once). Same SET NX EX primitive as idempotency.service.ts, but scoped to
// the parcel rather than a client-supplied idempotency key, and actively
// released on completion instead of left to expire. Redis is optional
// everywhere else in this app, so a Redis outage here degrades to "no lock"
// rather than blocking status updates entirely.
async function withParcelStatusLocks<T>(parcelIds: string[], fn: () => Promise<T>): Promise<T> {
  const uniqueIds = Array.from(new Set(parcelIds));
  const acquiredKeys: string[] = [];
  try {
    // One pipelined round trip for all ids rather than N sequential SET NX
    // calls — a bulk status change over e.g. 200 parcels was previously
    // paying 200 back-to-back Redis latencies just to acquire locks.
    let results: Array<[Error | null, unknown]> | null = null;
    try {
      const pipeline = redis.pipeline();
      for (const id of uniqueIds) {
        pipeline.set(`${PARCEL_STATUS_LOCK_PREFIX}${id}`, "1", "EX", PARCEL_STATUS_LOCK_TTL_SECONDS, "NX");
      }
      results = await pipeline.exec();
    } catch (error) {
      console.error("[Redis] Parcel status lock acquisition failed, proceeding without lock:", error);
    }
    if (results) {
      let contended = false;
      uniqueIds.forEach((id, i) => {
        const [err, value] = results![i] ?? [null, null];
        if (err) return; // this particular SET failed - treat as skipped, not locked
        if (value) {
          acquiredKeys.push(`${PARCEL_STATUS_LOCK_PREFIX}${id}`);
        } else {
          contended = true; // key already held by another in-flight request
        }
      });
      if (contended) {
        throw new AppError(409, "This order is being updated by another request - please retry.");
      }
    }
    return await fn();
  } finally {
    if (acquiredKeys.length) {
      try {
        await redis.del(...acquiredKeys);
      } catch (error) {
        console.error("[Redis] Failed to release parcel status lock(s):", error);
      }
    }
  }
}

// Which parcel column a rider gets written to, depending on the leg they're being assigned for.
const RIDER_ASSIGNMENT_FIELD: Partial<Record<parcel_status, "pickup_rider_id" | "delivery_rider_id">> = {
  rider_assigned: "pickup_rider_id",
  sent_for_delivery: "delivery_rider_id",
  // Sending an RTO parcel back to the vendor needs a rider to carry it.
  sent_to_vendor: "delivery_rider_id",
};

// Cancelling or failing an order must always record why, for the audit trail.
const REASON_REQUIRED_STATUSES: parcel_status[] = [
  "cancelled",
  "failed_pickup",
  "failed_delivery",
];

// Which leg (and therefore which assigned rider column) a given *current*
// status belongs to. A rider may only progress a parcel that is on the leg
// they were actually assigned to — pickup_rider_id for pickup-leg statuses,
// delivery_rider_id for delivery-leg statuses — never someone else's parcel.
const PICKUP_LEG_STATUSES: parcel_status[] = ["pickup_ordered", "rider_assigned", "picked_up", "failed_pickup"];
const DELIVERY_LEG_STATUSES: parcel_status[] = ["ready_to_deliver", "sent_for_delivery", "failed_delivery"];

// Statuses where a delivery rider is genuinely holding the parcel, or has just
// finished with it and must stay on record for COD attribution. Anywhere else
// the parcel is back with the hub and no rider has a claim on it - so
// parcels.delivery_rider_id is cleared on the way out (see leavingDelivery).
// Deliberately excludes ready_to_deliver: that means "waiting to be handed to
// a rider", which may well be a different one.
// sent_to_vendor/returned_to_vendor are here for the same "stays on record"
// reason as delivered: sent_to_vendor assigns a delivery rider (see
// RIDER_ASSIGNMENT_FIELD) to carry the RTO parcel back, so that rider's claim
// has to survive the hand-over to the vendor or their returns history empties
// out. Being in this set is what makes the claim *releasable* at all - without
// it leavingDelivery is false for every transition out of sent_to_vendor, so a
// super_admin forcing the parcel back off returned_to_vendor carried the old
// rider into whatever the parcel did next.
const DELIVERY_RIDER_HELD_STATUSES: parcel_status[] = [
  "sent_for_delivery",
  "failed_delivery",
  "delivered",
  "partially_delivered",
  "sent_to_vendor",
  "returned_to_vendor",
];

// The pickup-leg mirror of the release above, keyed on where the parcel is
// *going* rather than where it has been. pickup_ordered means "in the pool,
// waiting for a rider to be assigned" - the exact counterpart of
// ready_to_deliver on the delivery leg - so arriving there must drop whoever
// held it before, or a rider who failed a pickup keeps listing a parcel that
// is no longer theirs and offers them no action (RIDER_TRANSITIONS lets riders
// make that failed_pickup -> pickup_ordered move themselves).
//
// Deliberately NOT a "leaving a held set" rule like the delivery leg. Clearing
// pickup_rider_id at the hub hand-over (picked_up -> arrived) would erase the
// historical record of who collected the parcel, which riderHandledFilter, the
// dashboard's total_picked_up, the per-rider counts in auth.controller and the
// pickup-leg location label in finance.service all read.
function releasesPickupRider(newStatus: parcel_status): boolean {
  return newStatus === "pickup_ordered";
}

function assertRiderOwnsLeg(
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

// Rider read scope comes in two strengths, because "parcels I am responsible
// for right now" and "parcels I ever handled" are different questions and were
// previously answered by the same flat
// `pickup_rider_id = me OR delivery_rider_id = me`.
//
// ── Custody: what the rider app LISTS ────────────────────────────────────────
// A parcel is in a rider's list if they are its delivery rider, or if they are
// its pickup rider and it has not yet left the origin hub. Their custody ends
// at that handover: from dispatch onward the parcel is in someone else's hands
// - another hub, a delivery rider, or a 3PL - and it never comes back to them,
// not even once delivered.
//
// Both halves of the NCM complaint live here. A carrier moves the parcel to
// sent_for_delivery and then delivered with delivery_rider_id still NULL, so a
// scope that let the pickup rider keep it (a) dropped live NCM orders into
// their queue with delivery buttons that assertRiderOwnsLeg 403s on, and
// (b) filed NCM's completed deliveries under "Orders you have delivered" for
// whoever happened to collect the parcel days earlier.
//
// This is also the rule that matters most operationally: it works on APKs
// already installed in the field, because the server simply stops returning
// the rows the old client asks for.
const PICKUP_RIDER_CUSTODY_STATUSES: parcel_status[] = [...PICKUP_LEG_STATUSES, "arrived"];

function riderCustodyFilter(riderId: string): Prisma.parcelsWhereInput {
  return {
    OR: [
      { delivery_rider_id: riderId },
      { pickup_rider_id: riderId, status: { in: PICKUP_RIDER_CUSTODY_STATUSES } },
    ],
  };
}

// Same rule for the raw-SQL queries. `alias` prefixes the columns when the
// query joins (e.g. "p."); empty for single-table scans.
function riderCustodySql(riderId: string, alias = ""): Prisma.Sql {
  const col = (name: string) => Prisma.raw(`${alias}${name}`);
  return Prisma.sql`AND (
    ${col("delivery_rider_id")} = ${riderId}::uuid
    OR (${col("pickup_rider_id")} = ${riderId}::uuid
        AND ${col("status")}::text = ANY(${PICKUP_RIDER_CUSTODY_STATUSES}))
  )`;
}

// ── Handled: what the rider's STATS count ───────────────────────────────────
// Deliberately looser. "Picked Up" on the rider dashboard is a tally of work
// done, not a task list, so a parcel they collected still counts while it is in
// transit or out with a 3PL - narrowing this to custody would drop a rider's
// headline number to near zero whenever their day's pickups are mid-transit.
// The delivery leg is still excluded: a parcel out with a different rider was
// never this one's to count.
function riderHandledFilter(riderId: string): Prisma.parcelsWhereInput {
  return {
    OR: [
      { delivery_rider_id: riderId },
      { pickup_rider_id: riderId, status: { notIn: DELIVERY_LEG_STATUSES } },
    ],
  };
}

function riderHandledSql(riderId: string, alias = ""): Prisma.Sql {
  return riderScopeSqlFor(riderId, DELIVERY_LEG_STATUSES, alias);
}

function riderScopeSqlFor(riderId: string, excluded: parcel_status[], alias: string): Prisma.Sql {
  const col = (name: string) => Prisma.raw(`${alias}${name}`);
  return Prisma.sql`AND (
    ${col("delivery_rider_id")} = ${riderId}::uuid
    OR (${col("pickup_rider_id")} = ${riderId}::uuid
        AND ${col("status")}::text <> ALL(${excluded}))
  )`;
}

async function resolveActiveRider(riderId: string) {
  const rider = await prisma.riders.findFirst({
    where: { id: riderId, deleted_at: null, status: "active" },
  });
  if (!rider) {
    throw new AppError(400, "Rider not found or inactive");
  }
  return rider;
}

const locationName = (location?: { name: string; city: string | null; district: string | null } | null) => {
  // Location names already contain the district, so don't append it again.
  return location?.name ?? "";
};

const moneyToNumber = (value?: Prisma.Decimal | null) => value ? Number(value) : 0;

async function getActorScope(actor: OrderActor) {
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");
  const actorIsRider = actor.roles.includes("rider");
  const actorIsSales = actor.roles.includes("sales");

  // Vendor / vendor staff: resolved through the shared helper so both roles
  // land on the same vendor-scoping guarantees used elsewhere (finance, pricing).
  const ownVendorId = await resolveOwnVendorId(actor);
  if (ownVendorId) {
    return { vendorId: ownVendorId, vendorIds: undefined, riderId: undefined };
  }

  // Sales: scoped to the set of vendors (clients) they own. Staff/super_admin
  // are unrestricted, so this only applies to a pure sales account.
  if (actorIsSales && !isStaff) {
    const ownedVendors = await prisma.vendors.findMany({
      where: { sales_user_id: actor.id, deleted_at: null },
      select: { id: true },
    });
    return { vendorId: undefined, vendorIds: ownedVendors.map((v) => v.id), riderId: undefined };
  }

  const rider = actorIsRider
    ? await prisma.riders.findFirst({
        where: { user_id: actor.id, deleted_at: null, status: "active" },
        select: { id: true },
      })
    : null;

  if (actorIsRider && !rider) {
    throw new AppError(403, "Rider profile not found or inactive");
  }

  return { vendorId: undefined, vendorIds: undefined, riderId: rider?.id };
}

async function generateUniqueTrackingId(
  tx: Prisma.TransactionClient,
  retries = 0,
): Promise<string> {
  const trackingId = generateTrackingId();

  // FIX: database schema uses tracking_id
  const existing = await tx.parcels.findUnique({
    where: { tracking_id: trackingId },
    select: { id: true },
  });

  if (!existing) {
    return trackingId;
  }

  if (retries >= MAX_TRACKING_ID_RETRIES) {
    throw new AppError(500, "Failed to generate unique tracking ID");
  }

  return generateUniqueTrackingId(tx, retries + 1);
}

async function generateUniqueDispatchNo(
  tx: Prisma.TransactionClient,
  retries = 0,
): Promise<string> {
  const dispatchNo = generateDispatchNo();

  const existing = await tx.dispatches.findUnique({
    where: { dispatch_no: dispatchNo },
    select: { id: true },
  });

  if (!existing) {
    return dispatchNo;
  }

  if (retries >= MAX_TRACKING_ID_RETRIES) {
    throw new AppError(500, "Failed to generate unique dispatch number");
  }

  return generateUniqueDispatchNo(tx, retries + 1);
}

async function generateUniqueRunSheetNo(
  tx: Prisma.TransactionClient,
  retries = 0,
): Promise<string> {
  const sheetNo = generateRunSheetNo();

  const existing = await tx.run_sheets.findUnique({
    where: { sheet_no: sheetNo },
    select: { id: true },
  });

  if (!existing) {
    return sheetNo;
  }

  if (retries >= MAX_TRACKING_ID_RETRIES) {
    throw new AppError(500, "Failed to generate unique run sheet number");
  }

  return generateUniqueRunSheetNo(tx, retries + 1);
}

// One run sheet per hand-off: opened whenever parcels transition to
// sent_for_delivery with a rider. The sheet freezes what the rider took;
// delivered/failed progress is later read off the member parcels.
async function createRunSheet(
  tx: Prisma.TransactionClient,
  riderId: string,
  parcelIds: string[],
  createdBy: string,
) {
  const sheetNo = await generateUniqueRunSheetNo(tx);
  const sheet = await tx.run_sheets.create({
    data: {
      sheet_no: sheetNo,
      rider_id: riderId,
      created_by: createdBy,
    },
  });
  await tx.run_sheet_parcels.createMany({
    data: parcelIds.map((parcelId) => ({ run_sheet_id: sheet.id, parcel_id: parcelId })),
  });
  return sheet;
}

async function findOrCreateParty(
  tx: Prisma.TransactionClient,
  partyData: CreateOrderInput["sender"],
  // Parties are keyed by phone and reused across orders. By default a match is
  // returned as-is. `refreshExisting` re-syncs the reused record's name/address
  // to the incoming details - used for the sender, which is the vendor's own
  // identity: if the vendor's shop details change, their sender should reflect
  // the current values instead of whatever was first captured. Only provided,
  // changed fields are written, so an existing email / alternate phone is never
  // wiped by a sender profile that doesn't carry them.
  options?: { refreshExisting?: boolean },
) {
  const normalizedPhone = partyData.phone.trim().replace(/\s/g, "");

  const existing = await tx.parties.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { created_at: "desc" },
  });

  if (existing) {
    if (options?.refreshExisting) {
      const nextName = partyData.name.trim();
      const nextAddress = partyData.address?.trim();
      const update: Prisma.partiesUpdateInput = {};
      if (nextName && nextName !== existing.name) update.name = nextName;
      if (nextAddress && nextAddress !== (existing.address ?? "")) update.address = nextAddress;
      if (Object.keys(update).length > 0) {
        return tx.parties.update({ where: { id: existing.id }, data: update });
      }
    }
    return existing;
  }

  return tx.parties.create({
    data: {
      name: partyData.name.trim(),
      phone: normalizedPhone,
      alternate_phone: partyData.alternatePhone?.trim() || null,
      email: partyData.email?.trim() || null,
      address: partyData.address?.trim() || null,
    },
  });
}

async function createOrderCore(
  actor: OrderActor,
  data: CreateOrderInput,
  options?: CreateOrderOptions,
) {
  return _createOrderImpl(actor, data, options);
}

// Same-day duplicate guard for interactive (single) order creation only - bulk
// imports go through createOrderCore and are intentionally exempt. Flags an
// order whose vendor already created one today for the same receiver phone
// number. Soft guard: throws a DUPLICATE_ORDER 409 the client turns into a
// "create anyway?" prompt, and is bypassed when the user confirms
// (data.confirmDuplicate) or when the order isn't attributed to a vendor.
async function assertNotDuplicateOrder(actor: OrderActor, data: CreateOrderInput) {
  if (data.confirmDuplicate) return;

  const ownVendorId = await resolveOwnVendorId(actor);
  const vendorId = ownVendorId ?? data.vendorId ?? null;
  if (!vendorId) return;

  const receiverPhone = data.receiver.phone.trim().replace(/\s/g, "");
  if (!receiverPhone) return;

  // Start of today in Nepal local time (parcels.created_at is UTC).
  const nepalToday = formatDate(new Date());
  const todayStart = new Date(Date.parse(`${nepalToday}T00:00:00Z`) - NEPAL_UTC_OFFSET_MS);

  const existing = await prisma.parcels.findFirst({
    where: {
      vendor_id: vendorId,
      deleted_at: null,
      created_at: { gte: todayStart },
      parties_parcels_receiver_idToparties: {
        phone: receiverPhone,
      },
    },
    orderBy: { created_at: "desc" },
    select: { order_number: true, tracking_id: true },
  });

  if (existing) {
    throw new AppError(
      409,
      `A similar order for ${receiverPhone} was already created today (Order #${existing.order_number}, ${existing.tracking_id}).`,
      "DUPLICATE_ORDER",
    );
  }
}

interface CreateOrderOptions {
  // Set by bulkCreateOrders once it has cleared the importing vendor up front,
  // so a 500-row import doesn't re-check the same account 500 times.
  skipBillingCheck?: boolean;
}

export async function createOrder(actor: OrderActor, data: CreateOrderInput) {
  await assertNotDuplicateOrder(actor, data);
  const parcel = await _createOrderImpl(actor, data);
  // Fire-and-forget: Redis latency should never add to the caller's response time.
  invalidateOrderCaches().catch((err) => console.error("[Redis] cache invalidation failed:", err));
  if (parcel.vendor_id) {
    invalidateVendorFinanceCache(parcel.vendor_id).catch((err) => console.error("[Redis] cache invalidation failed:", err));
  }
  return parcel;
}

async function _createOrderImpl(
  actor: OrderActor,
  data: CreateOrderInput,
  options: CreateOrderOptions = {},
) {
  if (data.weightKg !== undefined && (!Number.isFinite(data.weightKg) || data.weightKg <= 0)) {
    throw new AppError(400, "weightKg must be a positive number");
  }
  if (data.codAmount !== undefined && (!Number.isFinite(data.codAmount) || data.codAmount < 0)) {
    throw new AppError(400, "codAmount cannot be negative");
  }
  if (data.itemValue !== undefined && (!Number.isFinite(data.itemValue) || data.itemValue < 0)) {
    throw new AppError(400, "itemValue cannot be negative");
  }
  if (data.deliveryCharge !== undefined && (!Number.isFinite(data.deliveryCharge) || data.deliveryCharge < 0)) {
    throw new AppError(400, "deliveryCharge cannot be negative");
  }
  if (data.pieces !== undefined && (!Number.isInteger(data.pieces) || data.pieces <= 0)) {
    throw new AppError(400, "pieces must be a positive integer");
  }

  // Resolves vendor AND vendor_staff actors to their own vendor - previously
  // only the "vendor" role was auto-resolved here, so orders created by a
  // vendor_staff account got vendor_id: null (orphaned from their vendor's
  // order list, COD collections, and settlements).
  const ownVendorId = await resolveOwnVendorId(actor);

  // A sales actor picking a vendorId (e.g. bulk-importing on behalf of a
  // client) can only ever pick a vendor they own - matches the sales_user_id
  // scoping already enforced on the vendor list / dashboard / tickets.
  const isSalesActor = actor.roles.includes("sales") && !isStaffActor(actor);

  // Hub inheritance: orders keyed in by a plain admin always originate from
  // that admin's own hub — only a super_admin may pick a different origin.
  if (isStaffActor(actor) && !actor.roles.includes("super_admin")) {
    const actorAdmin = await prisma.admins.findFirst({
      where: { user_id: actor.id },
      select: { location_id: true },
    });
    if (actorAdmin?.location_id) data.originLocationId = actorAdmin.location_id;
  }

  // Run the remaining two independent reads in parallel.
  const [vendor, originLoc, destinationLoc] = await Promise.all([
    ownVendorId
      ? prisma.vendors.findFirst({
          where: { id: ownVendorId, deleted_at: null, status: "active" },
        })
      : data.vendorId
      ? prisma.vendors.findFirst({
          where: {
            id: data.vendorId,
            deleted_at: null,
            status: "active",
            ...(isSalesActor ? { sales_user_id: actor.id } : {}),
          },
        })
      : Promise.resolve(null),
    data.originLocationId
      ? prisma.locations.findUnique({ where: { id: data.originLocationId } })
      : Promise.resolve(null),
    data.destinationLocationId
      ? prisma.locations.findUnique({ where: { id: data.destinationLocationId } })
      : Promise.resolve(null),
  ]);

  if (ownVendorId && !vendor) throw new AppError(403, "Vendor profile not found or inactive");
  if (!ownVendorId && data.vendorId && !vendor) throw new AppError(404, "Vendor not found or inactive");
  if (data.originLocationId && (!originLoc || !originLoc.is_active))
    throw new AppError(400, "Origin location not found or inactive");
  if (data.destinationLocationId && (!destinationLoc || !destinationLoc.is_active))
    throw new AppError(400, "Destination location not found or inactive");

  // Credit control. Sits here rather than in a controller because order
  // creation has three entry points - the dashboard, the bulk import, and the
  // partner API at POST /api/v1/orders - and all three funnel through this
  // function. A controller-level guard would leave the partner API open.
  //
  // The block follows the vendor, not the actor: an admin keying an order in on
  // behalf of a blocked vendor is blocked too. Only a super_admin can override,
  // and only by asking for it explicitly.
  if (vendor && !options.skipBillingCheck) {
    const overriding = data.overrideBillingBlock === true && actor.roles.includes("super_admin");
    if (!overriding) {
      await assertVendorCanCreateOrder(vendor.id);
    }
  }

  const resolvedOriginLocationId = data.originLocationId || data.sender.locationId || vendor?.location_id || null;
  const resolvedDestinationLocationId = data.destinationLocationId || data.receiver.locationId || null;
  const weightKg = data.weightKg || 1;

  // A return parcel is goods the customer hands back for the vendor (created on
  // an exchange delivery or a return pickup). It never carries COD, so force it
  // to 0 regardless of what the caller passed. It still incurs a delivery charge
  // (a percent of the normal rate, see below) which is billed via settlement.
  const isReturnOrder = (data.orderType || "delivery") === "return";
  const codAmount = isReturnOrder ? 0 : data.codAmount || 0;
  const itemValue = data.itemValue || 0;

  // Payable is computed server-side so the client can't spoof the charge. Vendor
  // orders price by the vendor's chosen rate model (per-destination / zone / flat);
  // non-vendor orders fall back to the legacy origin→destination route rate, then
  // to a manually supplied charge when no rate can be resolved. Return orders are
  // charged the vendor's return percent of that normal rate instead of the full rate.
  let deliveryCharge = data.deliveryCharge || 0;
  if (vendor && resolvedDestinationLocationId) {
    const overrides = {
      flatInsideValley: vendor.flat_inside_valley === null ? null : Number(vendor.flat_inside_valley),
      flatOutsideValley: vendor.flat_outside_valley === null ? null : Number(vendor.flat_outside_valley),
      zoneMajorCities: vendor.zone_major_cities === null ? null : Number(vendor.zone_major_cities),
      zoneUrbanAreas: vendor.zone_urban_areas === null ? null : Number(vendor.zone_urban_areas),
      zoneRemoteAreas: vendor.zone_remote_areas === null ? null : Number(vendor.zone_remote_areas),
      zoneInsideValley: vendor.zone_inside_valley === null ? null : Number(vendor.zone_inside_valley),
      insideValleyFlatRate: vendor.inside_valley_flat_rate === null ? null : Number(vendor.inside_valley_flat_rate),
      extraWeightPercent: vendor.extra_weight_percent === null ? null : Number(vendor.extra_weight_percent),
      ...branchOverrides(vendor),
      returnInsideValleyPercent: vendor.return_inside_valley_percent === null ? null : Number(vendor.return_inside_valley_percent),
      returnOutsideValleyPercent: vendor.return_outside_valley_percent === null ? null : Number(vendor.return_outside_valley_percent),
    };
    const serviceType = (data.serviceType as ServiceType) || "home_delivery";
    const quote = isReturnOrder
      ? await getReturnDeliveryQuote(vendor.rate_type as RateType, resolvedDestinationLocationId, weightKg, overrides, serviceType)
      : await getVendorQuote(vendor.rate_type as RateType, resolvedDestinationLocationId, weightKg, overrides, serviceType);
    deliveryCharge = quote.totalPayable;
  } else if (resolvedOriginLocationId && resolvedDestinationLocationId) {
    const quote = await getDeliveryQuote(
      resolvedOriginLocationId,
      resolvedDestinationLocationId,
      weightKg,
      (data.serviceType as ServiceType) || "home_delivery",
    );
    deliveryCharge = quote.totalPayable;
  }

  const senderPhone = data.sender.phone.trim().replace(/\s/g, "");
  const receiverPhone = data.receiver.phone.trim().replace(/\s/g, "");
  if (senderPhone === receiverPhone) {
    throw new AppError(400, "Sender and receiver cannot have the same phone number");
  }

  const parcel = await prisma.$transaction(async (tx) => {
    const trackingId = await generateUniqueTrackingId(tx);

    const [sender, receiver] = await Promise.all([
      // Sender is the vendor's own identity - keep it synced with their current
      // profile so a shop/address change propagates to new orders.
      findOrCreateParty(tx, data.sender, { refreshExisting: true }),
      findOrCreateParty(tx, data.receiver),
    ]);

    const parcel = await tx.parcels.create({
      data: {
        tracking_id: trackingId,
        search_text: buildSearchText(trackingId, sender, receiver),
        vendor_id: vendor?.id || null,
        sender_id: sender.id,
        receiver_id: receiver.id,
        origin_location_id: resolvedOriginLocationId,
        current_location_id: resolvedOriginLocationId,
        destination_location_id: resolvedDestinationLocationId,
        order_type: data.orderType || "delivery",
        service_type: data.serviceType || "home_delivery",
        status: "pickup_ordered",
        pieces: data.pieces || 1,
        weight_kg: weightKg,
        cod_amount: codAmount,
        item_value: itemValue,
        delivery_charge: deliveryCharge,
        // "Parcel" matches the dashboard's own create-order form, which
        // pre-fills the same value - so an order created with no package
        // type set (most API callers, since it's rarely relevant to them)
        // looks the same everywhere staff view it, instead of showing blank.
        package_type: data.packageType || "Parcel",
        delivery_instruction: data.deliveryInstruction || null,
        allow_partial_delivery: data.allowPartialDelivery ?? false,
        created_by: actor.id,
      },
    });

    // Secondary writes are logically independent, but tx is bound to a
    // single Postgres connection - Promise.all here doesn't run them in
    // parallel, it pipelines overlapping queries onto that one client, which
    // pg now deprecates ("client.query() called while already executing a
    // query", removed in pg@9). Awaited sequentially instead; same cost.
    await tx.parcel_status_history.create({
      data: {
        parcel_id: parcel.id,
        old_status: null,
        new_status: "pickup_ordered",
        location_id: parcel.current_location_id,
        changed_by: actor.id,
        remarks: "Order created",
      },
    });
    await tx.pickup_tasks.create({
      data: {
        parcel_id: parcel.id,
        pickup_address: data.pickupAddress || data.sender.address || null,
        scheduled_at: data.scheduledPickupAt ? new Date(data.scheduledPickupAt) : null,
        status: "pickup_ordered",
      },
    });
    await tx.cod_collections.create({
      data: {
        parcel_id: parcel.id,
        vendor_id: vendor?.id || null,
        cod_amount: codAmount,
        payment_status: "pending",
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "CREATE_ORDER",
        new_data: {
          trackingId: parcel.tracking_id,
          senderId: sender.id,
          receiverId: receiver.id,
        },
      },
    });
    if (data.remarks?.trim()) {
      await tx.parcel_remarks.create({
        data: {
          parcel_id: parcel.id,
          user_id: actor.id,
          remark: data.remarks.trim(),
        },
      });
    }

    return parcel;
  });

  // New orders no longer notify admins - a ping per created order floods the
  // notification feed. Admins are still notified on the actionable events
  // downstream (arrival at branch, delivery/COD settlement).

  return parcel;
}

// A parcel that has reached a terminal state is settled paperwork — its
// details (COD, receiver, route) feed finance and RTO records and must not
// change underneath them.
const EDIT_BLOCKED_STATUSES: parcel_status[] = [
  "delivered",
  "partially_delivered",
  "cancelled",
  "returned_to_vendor",
  "loss_and_damage",
];

// Vendor-side actors may only edit while the parcel is still theirs to hand
// over; once it's in the network, changes go through ops staff.
const VENDOR_EDITABLE_STATUSES: parcel_status[] = [
  "pickup_ordered",
  "rider_assigned",
  "failed_pickup",
];

// A parcel in EDIT_BLOCKED_STATUSES is otherwise settled paperwork, but a
// wrong COD amount (customer dispute, data-entry mistake) still needs
// correcting after delivery/RTV/RTO. Narrow escape hatch: super_admin or an
// admin holding EDIT_COD_LOCKED may still change codAmount alone, as long as
// the money hasn't actually moved yet - once cod_collections.payment_status
// is "paid" the parcel's COD must never drift from what was already settled.
// Callers decide "codAmount alone" from the actual before/after diff (see
// changedKeys below), not from which fields the request happened to include -
// the full-page edit form always resubmits every field, changed or not.
async function canOverrideCodOnBlockedParcel(actor: OrderActor, parcelId: string): Promise<boolean> {
  const isPrivileged =
    actor.roles.includes("super_admin") || (await hasAdminPermission(actor, "EDIT_COD_LOCKED"));
  if (!isPrivileged) return false;

  const collection = await prisma.cod_collections.findFirst({
    where: { parcel_id: parcelId },
    select: {
      payment_status: true,
      settlement_items: { select: { settlements: { select: { statement_id: true, payee_type: true } } }, take: 1 },
    },
  });
  if (collection && collection.payment_status !== "pending") {
    throw new AppError(409, "COD has already been settled to the vendor and can no longer be edited here.");
  }
  // Also blocked while still pending, if it's already bundled into a
  // settlement: that settlement's settlement_items row already froze this
  // collection's amount at creation time, and editing the COD here would
  // desync from it with no record of why. Staff must remove it via the
  // settlement edit flow first.
  if (collection && collection.settlement_items.length > 0) {
    const stmt = collection.settlement_items[0]!.settlements;
    throw new AppError(
      409,
      `This order is part of ${stmt.payee_type} settlement ${stmt.statement_id} — remove it from the settlement before editing COD.`,
    );
  }
  return true;
}

async function upsertPartyByPhone(
  tx: Prisma.TransactionClient,
  partyData: OrderPartyInput,
) {
  const normalizedPhone = partyData.phone.trim().replace(/\s/g, "");
  const existing = await tx.parties.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { created_at: "desc" },
  });
  const fields = {
    name: partyData.name.trim(),
    alternate_phone: partyData.alternatePhone?.trim() || null,
    address: partyData.address?.trim() || null,
  };
  if (existing) {
    return tx.parties.update({ where: { id: existing.id }, data: fields });
  }
  return tx.parties.create({ data: { ...fields, phone: normalizedPhone } });
}

export async function updateOrderDetails(
  actor: OrderActor,
  parcelId: string,
  data: UpdateOrderDetailsInput,
) {
  const ownVendorId = await resolveOwnVendorId(actor);
  // Defense in depth: sales aren't currently routed here, but if they ever are,
  // scope them to parcels of the vendors they own.
  const isStaffActor = actor.roles.some((r) => ["admin", "super_admin"].includes(r));
  const salesVendorIds = !ownVendorId && !isStaffActor && actor.roles.includes("sales")
    ? (await getActorScope(actor)).vendorIds
    : undefined;

  // Reassigning the order to a different vendor is an ops-staff action only —
  // a vendor/vendor_staff actor is already scoped to their own vendor_id via
  // the `parcel` lookup below, so letting them also pick a new vendorId here
  // would let them hand their parcel off to (or take one from) another vendor.
  if (data.vendorId !== undefined && ownVendorId) {
    throw new AppError(403, "Vendors cannot reassign the vendor on an order");
  }

  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      ...(ownVendorId ? { vendor_id: ownVendorId } : {}),
      ...(salesVendorIds ? { vendor_id: { in: salesVendorIds } } : {}),
    },
    include: {
      parties_parcels_sender_idToparties: true,
      parties_parcels_receiver_idToparties: true,
      vendors: true,
    },
  });
  if (!parcel) throw new AppError(404, "Order not found");

  if (ownVendorId && !VENDOR_EDITABLE_STATUSES.includes(parcel.status)) {
    throw new AppError(409, "This parcel is already in the delivery network — contact support to change it");
  }

  const [originLoc, destinationLoc, newVendor] = await Promise.all([
    data.originLocationId
      ? prisma.locations.findUnique({ where: { id: data.originLocationId } })
      : Promise.resolve(null),
    data.destinationLocationId
      ? prisma.locations.findUnique({ where: { id: data.destinationLocationId } })
      : Promise.resolve(null),
    data.vendorId
      ? prisma.vendors.findFirst({ where: { id: data.vendorId, deleted_at: null, status: "active" } })
      : Promise.resolve(null),
  ]);
  if (data.originLocationId && (!originLoc || !originLoc.is_active))
    throw new AppError(400, "Origin location not found or inactive");
  if (data.destinationLocationId && (!destinationLoc || !destinationLoc.is_active))
    throw new AppError(400, "Destination location not found or inactive");
  if (data.vendorId && !newVendor) throw new AppError(404, "Vendor not found or inactive");
  const vendorChanged = data.vendorId !== undefined && data.vendorId !== parcel.vendor_id;

  const currentReceiver = parcel.parties_parcels_receiver_idToparties;
  const currentWeight = parcel.weight_kg === null ? undefined : Number(parcel.weight_kg);

  // Return parcels never carry COD. If this order already is - or is now being
  // turned into - a return, force COD to 0 so it stays out of COD settlement.
  const effectiveOrderType = data.orderType ?? parcel.order_type;
  if (effectiveOrderType === "return") {
    data.codAmount = 0;
  }

  // Human-readable trail of what changed — each entry carries the previous and
  // new value ("COD amount: 1000 → 1200") and is written into the parcel's
  // history so the order detail page shows who edited what.
  const changedKeys = new Set<string>();
  const changedFields: string[] = [];
  const note = (key: string, oldValue: unknown, newValue: unknown) => {
    changedKeys.add(key);
    const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
    changedFields.push(`${key}: ${show(oldValue)} → ${show(newValue)}`);
  };
  if (vendorChanged) {
    note("vendor", parcel.vendors?.business_name || parcel.vendors?.client_name, newVendor?.business_name || newVendor?.client_name);
  }
  if (data.receiver) {
    const normalizedPhone = data.receiver.phone.trim().replace(/\s/g, "");
    if (data.receiver.name.trim() !== currentReceiver.name)
      note("receiver name", currentReceiver.name, data.receiver.name.trim());
    if (normalizedPhone !== currentReceiver.phone)
      note("receiver phone", currentReceiver.phone, normalizedPhone);
    if ((data.receiver.alternatePhone?.trim() || null) !== currentReceiver.alternate_phone)
      note("receiver alt phone", currentReceiver.alternate_phone, data.receiver.alternatePhone?.trim());
    if ((data.receiver.address?.trim() || null) !== currentReceiver.address)
      note("receiver address", currentReceiver.address, data.receiver.address?.trim());
  }
  if (data.originLocationId !== undefined && data.originLocationId !== parcel.origin_location_id) {
    const oldName = parcel.origin_location_id
      ? (await prisma.locations.findUnique({ where: { id: parcel.origin_location_id } }))?.name
      : null;
    note("origin", oldName ?? parcel.origin_location_id, originLoc?.name ?? data.originLocationId);
  }
  if (data.destinationLocationId !== undefined && data.destinationLocationId !== parcel.destination_location_id) {
    const oldName = parcel.destination_location_id
      ? (await prisma.locations.findUnique({ where: { id: parcel.destination_location_id } }))?.name
      : null;
    note("destination", oldName ?? parcel.destination_location_id, destinationLoc?.name ?? data.destinationLocationId);
  }
  if (data.orderType !== undefined && data.orderType !== parcel.order_type)
    note("order type", parcel.order_type, data.orderType);
  if (data.serviceType !== undefined && data.serviceType !== parcel.service_type)
    note("service type", parcel.service_type, data.serviceType);
  if (data.pieces !== undefined && data.pieces !== parcel.pieces) note("pieces", parcel.pieces, data.pieces);
  if (data.weightKg !== undefined && data.weightKg !== currentWeight)
    note("weight", currentWeight, data.weightKg);
  if (data.codAmount !== undefined && data.codAmount !== Number(parcel.cod_amount))
    note("COD amount", Number(parcel.cod_amount), data.codAmount);
  if (data.itemValue !== undefined && data.itemValue !== Number(parcel.item_value))
    note("Item value", Number(parcel.item_value), data.itemValue);
  if (data.packageType !== undefined && data.packageType !== (parcel.package_type || undefined))
    note("package type", parcel.package_type, data.packageType);
  if (data.deliveryInstruction !== undefined && data.deliveryInstruction !== (parcel.delivery_instruction || undefined))
    note("delivery instruction", parcel.delivery_instruction, data.deliveryInstruction);

  if (changedFields.length === 0) return parcel;

  if (EDIT_BLOCKED_STATUSES.includes(parcel.status)) {
    const isCodOnlyChange = changedKeys.size === 1 && changedKeys.has("COD amount");
    if (!isCodOnlyChange || !(await canOverrideCodOnBlockedParcel(actor, parcel.id))) {
      throw new AppError(409, `Order can no longer be edited in status "${parcel.status}"`);
    }
  }

  // Weight or destination changes re-price the parcel with the same waterfall
  // as order creation (vendor rate model, then route rate, else keep as-is).
  let deliveryCharge = Number(parcel.delivery_charge);
  const destinationLocationId = data.destinationLocationId ?? parcel.destination_location_id;
  const originLocationId = data.originLocationId ?? parcel.origin_location_id;
  const weightKg = data.weightKg ?? currentWeight ?? 1;
  const repriceNeeded =
    changedKeys.has("weight") || changedKeys.has("destination") || changedKeys.has("origin") || vendorChanged;
  // A vendor reassignment reprices against the NEW vendor's rate model, not the old one.
  const effectiveVendor = vendorChanged ? newVendor : parcel.vendors;
  if (repriceNeeded && destinationLocationId) {
    if (effectiveVendor) {
      const vendor = effectiveVendor;
      const overrides = {
        flatInsideValley: vendor.flat_inside_valley === null ? null : Number(vendor.flat_inside_valley),
        flatOutsideValley: vendor.flat_outside_valley === null ? null : Number(vendor.flat_outside_valley),
        zoneMajorCities: vendor.zone_major_cities === null ? null : Number(vendor.zone_major_cities),
        zoneUrbanAreas: vendor.zone_urban_areas === null ? null : Number(vendor.zone_urban_areas),
        zoneRemoteAreas: vendor.zone_remote_areas === null ? null : Number(vendor.zone_remote_areas),
        zoneInsideValley: vendor.zone_inside_valley === null ? null : Number(vendor.zone_inside_valley),
        insideValleyFlatRate: vendor.inside_valley_flat_rate === null ? null : Number(vendor.inside_valley_flat_rate),
        extraWeightPercent: vendor.extra_weight_percent === null ? null : Number(vendor.extra_weight_percent),
        ...branchOverrides(vendor),
        returnInsideValleyPercent: vendor.return_inside_valley_percent === null ? null : Number(vendor.return_inside_valley_percent),
        returnOutsideValleyPercent: vendor.return_outside_valley_percent === null ? null : Number(vendor.return_outside_valley_percent),
      };
      const serviceType = (data.serviceType ?? parcel.service_type) as ServiceType;
      // Return orders re-price at the vendor's return percent of the normal rate.
      const quote = effectiveOrderType === "return"
        ? await getReturnDeliveryQuote(vendor.rate_type as RateType, destinationLocationId, weightKg, overrides, serviceType)
        : await getVendorQuote(vendor.rate_type as RateType, destinationLocationId, weightKg, overrides, serviceType);
      deliveryCharge = quote.totalPayable;
    } else if (originLocationId) {
      const quote = await getDeliveryQuote(
        originLocationId,
        destinationLocationId,
        weightKg,
        (data.serviceType ?? parcel.service_type) as ServiceType,
      );
      deliveryCharge = quote.totalPayable;
    }
  }

  // Correcting COD on an already-delivered parcel (see canOverrideCodOnBlockedParcel
  // above) has to keep cod_collections.collected_amount honest, or the
  // settlement ledger keeps showing the pre-correction figure as cash in hand.
  // How depends on which kind of delivery it was:
  //   - "delivered": the rider collected the full declared COD, so collected
  //     tracks the corrected amount exactly.
  //   - "partially_delivered": collected is an independently counted figure -
  //     the cash the customer actually handed over. Correcting a wrong DECLARED
  //     amount must not move COUNTED cash, so it's left alone and only clamped
  //     if the correction drops the total below what was already collected.
  // Other blocked statuses (cancelled/returned_to_vendor/loss_and_damage) never
  // had a real collection event, so their collected_amount stays untouched.
  // Same "still pending" guard as the cod_amount write below - once the vendor
  // leg is paid, the parcel's COD can no longer drift from what was settled.
  let codSyncCollectedAmount: number | null = null;
  if (
    data.codAmount !== undefined &&
    changedKeys.has("COD amount") &&
    ["delivered", "partially_delivered"].includes(parcel.status)
  ) {
    const existingCod = await prisma.cod_collections.findUnique({
      where: { parcel_id: parcel.id },
      select: { collected_amount: true, payment_status: true },
    });
    if (existingCod && existingCod.payment_status === "pending") {
      codSyncCollectedAmount =
        parcel.status === "delivered"
          ? data.codAmount
          : Math.min(Number(existingCod.collected_amount), data.codAmount);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    let receiverId = parcel.receiver_id;
    let receiver = currentReceiver;
    if (data.receiver) {
      receiver = await upsertPartyByPhone(tx, data.receiver);
      receiverId = receiver.id;
    }

    // Sender is the vendor's own identity (same as order creation) — when the
    // vendor is reassigned, the sender party is re-resolved from the NEW
    // vendor's profile instead of staying pinned to the old one.
    let senderId = parcel.sender_id;
    let sender = parcel.parties_parcels_sender_idToparties;
    if (vendorChanged && newVendor) {
      sender = await findOrCreateParty(
        tx,
        {
          name: newVendor.business_name || newVendor.client_name,
          phone: newVendor.phone,
          ...(newVendor.address ? { address: newVendor.address } : {}),
          ...(newVendor.location_id ? { locationId: newVendor.location_id } : {}),
        },
        { refreshExisting: true },
      );
      senderId = sender.id;
    }

    const updatedParcel = await tx.parcels.update({
      where: { id: parcel.id },
      data: {
        vendor_id: vendorChanged ? newVendor!.id : parcel.vendor_id,
        sender_id: senderId,
        receiver_id: receiverId,
        origin_location_id: originLocationId,
        destination_location_id: destinationLocationId,
        order_type: data.orderType ?? parcel.order_type,
        service_type: data.serviceType ?? parcel.service_type,
        pieces: data.pieces ?? parcel.pieces,
        weight_kg: weightKg,
        cod_amount: data.codAmount ?? parcel.cod_amount,
        // Mirrors the clamp above so the parcel's own record of the partial
        // never exceeds (or disagrees with) the collection it's derived from.
        ...(codSyncCollectedAmount !== null && parcel.status === "partially_delivered"
          ? { partial_cod_collected: codSyncCollectedAmount }
          : {}),
        item_value: data.itemValue ?? parcel.item_value,
        delivery_charge: deliveryCharge,
        package_type: data.packageType !== undefined ? data.packageType || null : parcel.package_type,
        delivery_instruction:
          data.deliveryInstruction !== undefined ? data.deliveryInstruction || null : parcel.delivery_instruction,
        search_text: buildSearchText(parcel.tracking_id, sender, receiver),
      },
    });

    const writes: Prisma.PrismaPromise<unknown>[] = [
      // Same-status history entry: records WHO edited the parcel info and what
      // they touched, without pretending the status moved.
      tx.parcel_status_history.create({
        data: {
          parcel_id: parcel.id,
          old_status: parcel.status,
          new_status: parcel.status,
          location_id: parcel.current_location_id,
          changed_by: actor.id,
          remarks: `Parcel info edited — ${changedFields.join("; ")}`.slice(0, 500),
        },
      }),
      tx.audit_logs.create({
        data: {
          actor_id: actor.id,
          entity_type: "parcel",
          entity_id: parcel.id,
          action: "UPDATE_ORDER",
          old_data: {
            receiverId: parcel.receiver_id,
            destinationLocationId: parcel.destination_location_id,
            codAmount: Number(parcel.cod_amount),
            itemValue: Number(parcel.item_value),
            weightKg: currentWeight ?? null,
            deliveryCharge: Number(parcel.delivery_charge),
          },
          new_data: {
            changedFields,
            receiverId,
            destinationLocationId,
            codAmount: Number(updatedParcel.cod_amount),
            itemValue: Number(updatedParcel.item_value),
            weightKg: Number(updatedParcel.weight_kg),
            deliveryCharge: Number(updatedParcel.delivery_charge),
          },
        },
      }),
    ];
    // cod_collections.vendor_id is denormalized off the parcel for fast
    // per-vendor settlement queries — keep it in sync on reassignment.
    // Scoped to still-pending rows, same as the codAmount sync below: once
    // collected/settled, EDIT_BLOCKED_STATUSES already forbids editing the parcel.
    if (vendorChanged || (data.codAmount !== undefined && changedKeys.has("COD amount"))) {
      writes.push(
        tx.cod_collections.updateMany({
          where: { parcel_id: parcel.id, payment_status: "pending" },
          // Blanket-zeroing collected_amount here used to be safe because
          // EDIT_BLOCKED_STATUSES kept this path off delivered parcels. It no
          // longer does - EDIT_COD_LOCKED lets staff correct the COD on a
          // delivered/RTV/RTO parcel - so the collected figure has to be
          // resolved by the caller (codSyncCollectedAmount) rather than reset.
          data: {
            ...(data.codAmount !== undefined && changedKeys.has("COD amount") ? { cod_amount: data.codAmount } : {}),
            ...(codSyncCollectedAmount !== null ? { collected_amount: codSyncCollectedAmount } : {}),
            ...(vendorChanged ? { vendor_id: newVendor!.id } : {}),
          },
        }),
      );
    }
    await Promise.all(writes);

    return updatedParcel;
  });

  invalidateOrderCaches().catch((err) => console.error("[Redis] cache invalidation failed:", err));
  if (parcel.vendor_id) {
    invalidateVendorFinanceCache(parcel.vendor_id).catch((err) =>
      console.error("[Redis] cache invalidation failed:", err),
    );
  }
  if (vendorChanged && newVendor) {
    invalidateVendorFinanceCache(newVendor.id).catch((err) =>
      console.error("[Redis] cache invalidation failed:", err),
    );
  }

  return updated;
}

// A redirect is only meaningful while the parcel can still be re-routed: once
// it's delivered, returned or written off, the destination is history. The last
// point ops can still act is sent_for_delivery (call the rider back), so
// everything past that - and the whole RTO chain - is closed to redirects.
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

  const parcel = await prisma.parcels.findFirst({
    where: { id: parcelId, deleted_at: null },
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

const BULK_CREATE_MAX = 100;

// Each order runs its own multi-query transaction (tracking id, party lookup,
// rate quote, parcel + 4 secondary writes). Running all of them fully
// sequentially serializes ~12+ round trips per order across the whole batch,
// which risks request timeouts at BULK_CREATE_MAX. Capped concurrency keeps
// orders isolated (one failing order still can't affect another) while
// staying well under the DB pool's connection limit (see lib/prisma.ts).
const BULK_CREATE_CONCURRENCY = 5;

export async function bulkCreateOrders(actor: OrderActor, input: BulkCreateOrderInput, signal?: AbortSignal) {
  if (!Array.isArray(input.orders) || input.orders.length === 0) {
    throw new AppError(400, "orders must be a non-empty array");
  }
  if (input.orders.length > BULK_CREATE_MAX) {
    throw new AppError(400, `Maximum ${BULK_CREATE_MAX} orders per bulk request`);
  }

  // Credit control, resolved once for the whole import instead of per row.
  // When the importer is a vendor account every row belongs to that vendor, so
  // one check clears the batch and the per-row guard can be skipped. A staff or
  // sales importer can name a different vendor on each row, so those fall
  // through to the per-row check (cheap - it reads the cached balance).
  const importingVendorId = await resolveOwnVendorId(actor);
  if (importingVendorId) {
    await assertVendorCanCreateOrder(importingVendorId);
  }

  let created = 0;
  let failed = 0;
  const results: Array<
    | { index: number; success: true; trackingId: string }
    | { index: number; success: false; error: string }
  > = new Array(input.orders.length);
  const vendorIdsToInvalidate = new Set<string>();

  // Cheap, DB-free validation happens up front and in original order;
  // only orders that pass it hit the database.
  const toCreate: Array<{ index: number; data: CreateOrderInput }> = [];

  for (let i = 0; i < input.orders.length; i++) {
    const raw = input.orders[i]!;
    // Merge defaultSender only when the order doesn't supply its own sender.
    const resolvedSender: OrderPartyInput | undefined =
      raw.sender?.phone ? raw.sender : input.defaultSender;

    if (!resolvedSender?.name || !resolvedSender?.phone) {
      results[i] = { index: i, success: false, error: "Sender name and phone are required" };
      failed++;
      continue;
    }

    if (!raw.receiver?.name || !raw.receiver?.phone) {
      results[i] = { index: i, success: false, error: "Receiver name and phone are required" };
      failed++;
      continue;
    }

    toCreate.push({
      index: i,
      data: { ...raw, sender: resolvedSender, receiver: raw.receiver },
    });
  }

  for (let start = 0; start < toCreate.length; start += BULK_CREATE_CONCURRENCY) {
    if (signal?.aborted) {
      // Client disconnected - stop opening new transactions for orders it'll
      // never see the result of. Record the remainder as not-processed
      // rather than silently omitting them, so this (still-cached, since
      // it's not an error) response stays honest about what happened; a
      // genuinely new attempt needs a fresh Idempotency-Key, not a retry of
      // this one, since some of this batch already committed.
      for (let j = start; j < toCreate.length; j++) {
        const { index } = toCreate[j]!;
        results[index] = { index, success: false, error: "Not processed - request was cancelled by the client" };
        failed++;
      }
      break;
    }

    const chunk = toCreate.slice(start, start + BULK_CREATE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(({ data }) => createOrderCore(actor, data, { skipBillingCheck: Boolean(importingVendorId) })),
    );

    settled.forEach((outcome, offset) => {
      const { index } = chunk[offset]!;
      if (outcome.status === "fulfilled") {
        const parcel = outcome.value;
        results[index] = { index, success: true, trackingId: parcel.tracking_id };
        created++;
        if (parcel.vendor_id) vendorIdsToInvalidate.add(parcel.vendor_id);
      } else {
        const err = outcome.reason as any;
        results[index] = { index, success: false, error: err?.message || "Order creation failed" };
        failed++;
      }
    });
  }

  // Flush caches once for the whole batch instead of after each individual order.
  if (created > 0) {
    await invalidateOrderCaches();
    await Promise.all(Array.from(vendorIdsToInvalidate, (id) => invalidateVendorFinanceCache(id)));
  }

  // New orders no longer notify admins (see createOrder) - a bulk import would
  // otherwise fire a ping per parcel and bury the feed.

  return { created, failed, results };
}

function buildOrdersWhere(
  scope: { vendorId: string | undefined; vendorIds?: string[] | undefined; riderId: string | undefined },
  query: ListOrdersQuery,
): Prisma.parcelsWhereInput {
  // The trash view is the one place that wants soft-deleted rows; everywhere
  // else `deleted_at: null` is what keeps them hidden.
  const conditions: Prisma.parcelsWhereInput[] = [
    query.trashed ? { deleted_at: { not: null } } : { deleted_at: null },
  ];

  if (scope.vendorId) {
    conditions.push({ vendor_id: scope.vendorId });
  }
  // Sales accounts are scoped to a set of owned vendors. An empty set means
  // they own no clients yet, so they should see nothing.
  if (scope.vendorIds) {
    conditions.push({ vendor_id: { in: scope.vendorIds } });
  }
  if (scope.riderId) {
    conditions.push(riderCustodyFilter(scope.riderId));
  }
  if (query.status?.length) {
    conditions.push({ status: { in: query.status as parcel_status[] } });
  }
  if (query.orderType) {
    conditions.push({ order_type: query.orderType });
  }
  // Explicit vendor filter from the UI. Pushed into the query (rather than
  // filtered client-side over one page) so pagination, totals and the tab
  // counts all reflect the selected vendors. It's a separate AND condition
  // from the scope ones above, so a vendor/sales actor can only ever narrow
  // their own scope with it, never escape it.
  if (query.vendorId?.length) {
    conditions.push({ vendor_id: { in: query.vendorId } });
  }
  if (query.deliveryRiderId) {
    conditions.push({ delivery_rider_id: query.deliveryRiderId });
  }
  // Same local-midnight anchor getDashboardSummary uses for todays_delivered,
  // so the "Delivered today" card and its drill-down can't disagree.
  if (query.deliveredToday) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    conditions.push({ delivered_at: { gte: todayStart } });
  }

  // Date range, bucketed by Nepal-local day so it agrees with the dates the
  // list itself renders (mapOrder formats createdAt the same way).
  const dayRange = nepalDayRangeUtc(query.dateFrom, query.dateTo);
  if (dayRange.gte || dayRange.lt) {
    if (query.dateField === "lastUpdatedAt") {
      // "Status updated" is the newest parcel_status_history row, falling back
      // to updated_at for a parcel that has none - the same value mapOrder
      // reports as lastUpdatedAt. `some(>= from)` + `none(>= to)` pins the
      // *latest* row into the window; `some` alone would also match an order
      // that merely passed through it on the way to a later status.
      const latestInRange: Prisma.parcelsWhereInput[] = [];
      if (dayRange.gte) {
        latestInRange.push({ parcel_status_history: { some: { created_at: { gte: dayRange.gte } } } });
      }
      if (dayRange.lt) {
        latestInRange.push({ parcel_status_history: { none: { created_at: { gte: dayRange.lt } } } });
      }
      conditions.push({
        OR: [
          { AND: latestInRange },
          { AND: [{ parcel_status_history: { none: {} } }, { updated_at: dayRange }] },
        ],
      });
    } else {
      conditions.push({ created_at: dayRange });
    }
  }

  const search = query.search?.trim();
  if (search) {
    const terms = search.split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length > 1) {
      // A scan batch is tracking ids, but the same box accepts a pasted list of
      // order ids, so "#2980" in the list resolves too. Bare numbers stay
      // tracking-id-only here - in a scan batch they're far likelier to be a
      // mis-scan than an order id.
      const orderNumbers = terms
        .filter((t) => t.startsWith("#"))
        .map(parseOrderNumber)
        .filter((n): n is number => n !== null);
      conditions.push({
        OR: [
          ...terms.map((t) => ({ tracking_id: { equals: t, mode: "insensitive" as const } })),
          ...(orderNumbers.length ? [{ order_number: { in: orderNumbers } }] : []),
        ],
      });
    } else {
      const orderNumber = parseOrderNumber(search);
      if (orderNumber !== null && search.startsWith("#")) {
        // "#2980" is unambiguous - the user wants that one order, so don't
        // dilute it with the phone numbers that contain 2980.
        conditions.push({ order_number: orderNumber });
      } else {
        // Single-column GIN trigram search — no JOINs, stays fast at any table size.
        // Covers: tracking_id, sender/receiver name, sender/receiver phone.
        // A bare number could be either, so try it as an order id as well.
        conditions.push({
          OR: [
            { search_text: { contains: search.toLowerCase(), mode: "insensitive" as const } },
            ...(orderNumber !== null ? [{ order_number: orderNumber }] : []),
          ],
        });
      }
    }
  }

  return { AND: conditions };
}

export interface OrderFilterOptions {
  origins: string[];
  destinations: string[];
  riders: string[];
}

// Lightweight sibling to listOrders, purely for populating the tab-scoped
// origin/rider/destination filter dropdowns on the orders list page. Selects
// only the handful of columns those dropdowns need instead of the full
// ORDERS_INCLUDE (both parties, both locations, vendor, both riders, remarks,
// status history+users+roles) that the page previously reused here just to
// read three strings per row - doubling the backend cost of every non-"All"
// tab view for no reason.
export async function getOrderFilterOptions(
  actor: OrderActor,
  status?: ListOrdersQuery["status"],
): Promise<OrderFilterOptions> {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);
  const where = buildOrdersWhere({ vendorId, vendorIds, riderId }, status?.length ? { status } : {});

  const rows = await prisma.parcels.findMany({
    where,
    select: {
      locations_parcels_origin_location_idTolocations: { select: { name: true } },
      locations_parcels_destination_location_idTolocations: { select: { name: true } },
      parties_parcels_sender_idToparties: { select: { address: true } },
      parties_parcels_receiver_idToparties: { select: { address: true } },
      riders_parcels_delivery_rider_idToriders: { select: { name: true } },
      riders_parcels_pickup_rider_idToriders: { select: { name: true } },
    },
    take: 200,
  });

  const origins = new Set<string>();
  const destinations = new Set<string>();
  const riders = new Set<string>();
  for (const row of rows) {
    const origin =
      row.locations_parcels_origin_location_idTolocations?.name ||
      row.parties_parcels_sender_idToparties.address ||
      "";
    const destination =
      row.locations_parcels_destination_location_idTolocations?.name ||
      row.parties_parcels_receiver_idToparties.address ||
      "";
    const rider =
      row.riders_parcels_delivery_rider_idToriders?.name ||
      row.riders_parcels_pickup_rider_idToriders?.name ||
      "";
    if (origin) origins.add(origin);
    if (destination) destinations.add(destination);
    if (rider) riders.add(rider);
  }

  return {
    origins: Array.from(origins),
    destinations: Array.from(destinations),
    riders: Array.from(riders),
  };
}

/** Per-status totals for the orders list page's tab badges. */
export type OrderCountsByStatus = Record<ParcelStatus, number>;

// Every list filter except `status`, each also accepting an explicit
// `undefined` — the controller forwards a parsed query object wholesale, and
// under exactOptionalPropertyTypes a plain `Omit<ListOrdersQuery, "status">`
// would reject the absent-but-present keys that produces.
export type OrderCountsByStatusFilters = {
  [K in keyof Omit<ListOrdersQuery, "status">]?: ListOrdersQuery[K] | undefined;
};

// Counts every status in one grouped query rather than one COUNT per tab.
// The list page's tabs are overlapping status groups (failed_delivery is in
// both Inprogress and Failed; Return process is a subset of RTV), so summing
// per-status numbers on the caller's side is both cheaper and the only way to
// get those overlaps right — a per-tab COUNT would double-count nothing but
// would need one round trip per tab to say so.
export async function getOrderCountsByStatus(
  actor: OrderActor,
  query: OrderCountsByStatusFilters = {},
): Promise<OrderCountsByStatus> {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);
  // `status` is deliberately left out: the group-by supplies it per row.
  const where = buildOrdersWhere({ vendorId, vendorIds, riderId }, query as ListOrdersQuery);

  const rows = await prisma.parcels.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });

  // Seed every status at 0 so a tab with no orders renders "0" instead of
  // dropping its badge the moment the last order leaves that status. Seeded
  // from the Prisma enum so a status added to the schema can't be missed here.
  const counts = Object.fromEntries(
    Object.values(parcel_status).map((status) => [status, 0]),
  ) as OrderCountsByStatus;
  for (const row of rows) {
    counts[row.status as ParcelStatus] = row._count._all;
  }
  return counts;
}

const ORDERS_INCLUDE = {
  parties_parcels_sender_idToparties: true,
  parties_parcels_receiver_idToparties: true,
  locations_parcels_origin_location_idTolocations: true,
  locations_parcels_destination_location_idTolocations: true,
  vendors: true,
  riders_parcels_pickup_rider_idToriders: true,
  riders_parcels_delivery_rider_idToriders: true,
  parcel_remarks: {
    orderBy: { created_at: "desc" as const },
    take: 1,
  },
  parcel_status_history: {
    orderBy: { created_at: "desc" as const },
    take: 1,
    include: { users: { include: { user_roles: { include: { roles: true } } } } },
  },
  // One column, not the whole row. cod_collections.parcel_id is unique, so this
  // is a single indexed join per parcel - but this include is already the
  // expensive part of every list query (see the note above getOrderFilterOptions),
  // so it takes only the figure the finance column actually renders.
  cod_collections: { select: { collected_amount: true } },
} satisfies Prisma.parcelsInclude;

// Role tag appended to "last updated by" so staff can tell at a glance which
// side of the system touched the parcel. Ordered by precedence: a user with
// several roles gets the most privileged tag.
const LAST_UPDATED_BY_ROLE_TAGS: [string, string][] = [
  ["super_admin", "Super Admin"],
  ["admin", "Staff"],
  ["sales", "Sales"],
  ["rider", "Rider"],
  ["vendor", "Vendor"],
  ["vendor_staff", "Vendor Staff"],
];

export interface ListOrdersResult {
  data: ReturnType<typeof mapOrder>[];
  meta?: {
    // Display hint only under keyset pagination - the client tracks its own
    // page counter; the server just clamps it into [1, totalPages].
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    // Set when the caller didn't ask for pagination and the result was capped -
    // lets the UI show "showing 200 of N" instead of silently looking complete.
    truncated?: boolean;
    // Keyset navigation - present on paginated queries.
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
    nextCursor?: string | null;
    prevCursor?: string | null;
  };
}

function mapOrder(
  parcel: Prisma.parcelsGetPayload<{ include: typeof ORDERS_INCLUDE }>,
  isStaff: boolean,
  // True only when the caller *is* the vendor that owns these parcels (vendor
  // or vendor_staff) - i.e. getActorScope resolved an own-vendor id.
  isOwnVendorViewer: boolean,
  // Only populated for exports, where the caller batch-fetches the first
  // "arrived at origin" timestamp per parcel (see fetchArrivedAtOriginMap).
  arrivedByParcelId?: Map<string, string>,
) {
  const latestHistory = parcel.parcel_status_history[0];
  // The delivery rider is who this column is about; the pickup rider only
  // stands in while the parcel is still on the pickup leg. Past that, falling
  // back to them labelled whoever collected the parcel as its delivery rider -
  // so a 3PL-carried order (no delivery rider at all) showed up in ops looking
  // like it had been assigned to a rider who never saw it again.
  const rider =
    parcel.riders_parcels_delivery_rider_idToriders ||
    (PICKUP_LEG_STATUSES.includes(parcel.status) || parcel.status === "arrived"
      ? parcel.riders_parcels_pickup_rider_idToriders
      : null);
  const vendorName = parcel.vendors?.business_name || parcel.vendors?.client_name || "";
  // A vendor's label-size override describes the sticker stock loaded in
  // *their own* printer, so it only applies when the vendor is the one
  // printing. Ops/admin screens print the same parcel on branch stock, which
  // is always the standard 100x75mm - so they get the app default regardless
  // of what the vendor configured for themselves.
  const labelSize = resolveLabelSize(isOwnVendorViewer ? parcel.vendors : null);

  // Staff see who (which user) last changed the status; vendors/riders only
  // see which branch/company made the change - never an internal staff name
  // (matches the redaction already applied to getOrderByTrackingId's
  // statusHistory[].changedBy).
  let lastUpdatedBy = "";
  if (isStaff) {
    const historyUser = latestHistory?.users;
    if (historyUser) {
      const roleCodes = new Set(historyUser.user_roles.map(ur => ur.roles.code));
      const roleTag = LAST_UPDATED_BY_ROLE_TAGS.find(([code]) => roleCodes.has(code))?.[1];
      // A vendor account's user name is often just the login contact - the
      // business name is what staff recognise.
      const displayName = roleCodes.has("vendor") && vendorName ? vendorName : historyUser.full_name;
      lastUpdatedBy = roleTag ? `${displayName} (${roleTag})` : displayName;
    }
  } else {
    lastUpdatedBy =
      locationName(parcel.locations_parcels_origin_location_idTolocations) || vendorName || "Branch";
  }

  return {
    id: parcel.id,
    orderNumber: parcel.order_number,
    trackingId: parcel.tracking_id,
    status: parcel.status,
    statusLabel: getVendorStatusLabel(parcel.status),
    orderType: parcel.order_type,
    serviceType: parcel.service_type,
    senderName: parcel.parties_parcels_sender_idToparties.name,
    senderPhone: parcel.parties_parcels_sender_idToparties.phone,
    senderAddress: parcel.parties_parcels_sender_idToparties.address || "",
    receiverName: parcel.parties_parcels_receiver_idToparties.name,
    receiverPhone: parcel.parties_parcels_receiver_idToparties.phone,
    receiverAlternatePhone: parcel.parties_parcels_receiver_idToparties.alternate_phone || "",
    receiverAddress: parcel.parties_parcels_receiver_idToparties.address || "",
    originLocationId: parcel.origin_location_id,
    destinationLocationId: parcel.destination_location_id,
    origin:
      locationName(parcel.locations_parcels_origin_location_idTolocations) ||
      parcel.parties_parcels_sender_idToparties.address ||
      "",
    destination:
      locationName(parcel.locations_parcels_destination_location_idTolocations) ||
      parcel.parties_parcels_receiver_idToparties.address ||
      "",
    // Raw destination hub name - shipping labels print this.
    destinationName:
      parcel.locations_parcels_destination_location_idTolocations?.name ||
      parcel.parties_parcels_receiver_idToparties.address ||
      "",
    destinationValley: parcel.locations_parcels_destination_location_idTolocations?.valley ?? null,
    pieces: parcel.pieces,
    weightKg: parcel.weight_kg === null ? undefined : Number(parcel.weight_kg),
    attemptCount: parcel.attempt_count,
    codAmount: Number(parcel.cod_amount),
    itemValue: Number(parcel.item_value),
    deliveryCharge: Number(parcel.delivery_charge),
    // Cash actually taken from the receiver, as opposed to cod_amount, which is
    // what was meant to be taken. The two differ on a partial delivery, and
    // collected stays 0 until someone marks the parcel delivered. This is the
    // same figure finance settles on and the ledger posts from.
    collectedAmount: Number(parcel.cod_collections?.collected_amount ?? 0),
    packageType: parcel.package_type || "",
    deliveryInstruction: parcel.delivery_instruction || "",
    vendorId: parcel.vendor_id,
    vendorName,
    vendorLocation: parcel.vendors?.pickup_landmark || "",
    // Resolved sticker print size (vendor's own override, or the app
    // default) - see printLabels.ts on the client.
    labelWidthMm: labelSize.widthMm,
    labelHeightMm: labelSize.heightMm,
    riderName: rider?.name || "",
    remarks: stripCarrierStaffTag(parcel.parcel_remarks[0]?.remark || "").text,
    // Vendor-declared eligibility at creation, plus the actual outcome once a
    // rider/admin marks the parcel partially_delivered (both null/false until then).
    allowPartialDelivery: parcel.allow_partial_delivery,
    partialDeliveryRemarks: parcel.partial_delivery_remarks || null,
    partialCodCollected:
      parcel.partial_cod_collected === null ? null : Number(parcel.partial_cod_collected),
    // Set only on an auto-created return leg — points back at the exchange
    // order it was generated from (see order_type "exchange" + exchangeReturnReceived).
    sourceOrderId: parcel.source_order_id,
    lastUpdatedBy,
    // Full timestamp (not just the day) so the UI can show the time alongside
    // the date; date-only consumers still render fine via toBsDate().
    lastUpdatedAt: (latestHistory?.created_at || parcel.updated_at).toISOString(),
    createdAt: formatDate(parcel.created_at),
    createdAtRaw: parcel.created_at.toISOString(),
    arrivedAtOrigin: arrivedByParcelId?.get(parcel.id) ?? "",
    deliveredAt: parcel.delivered_at ? formatDate(parcel.delivered_at) : "",
  };
}

// Batch-fetches the first "arrived at origin" date (Nepal-local "YYYY-MM-DD")
// for each parcel id, in one indexed query. Used only by the export path so the
// regular list/table queries stay lean.
async function fetchArrivedAtOriginMap(parcelIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (parcelIds.length === 0) return map;
  const rows = await prisma.parcel_status_history.findMany({
    where: { parcel_id: { in: parcelIds }, new_status: "arrived" },
    select: { parcel_id: true, created_at: true },
    orderBy: { created_at: "asc" },
  });
  // asc order → the first row seen for a parcel is its earliest arrival.
  for (const row of rows) {
    if (!map.has(row.parcel_id)) map.set(row.parcel_id, formatDate(row.created_at));
  }
  return map;
}

// Allow-listed so a client can only sort by a column that's actually indexed
// or cheap to sort, never an arbitrary/unindexed field.
// "createdAt" maps to order_number, not created_at: the column is
// timestamptz(6) but JS Dates only carry milliseconds, so a created_at keyset
// cursor would be lossy and could skip rows sharing a millisecond. The
// autoincrement order_number has identical ordering semantics and round-trips
// exactly through a cursor.
const ORDER_SORT_COLUMNS = {
  createdAt: "order_number",
  codAmount: "cod_amount",
  deliveryCharge: "delivery_charge",
  trackingId: "tracking_id",
  status: "status",
} as const satisfies Record<OrderSortField, keyof Prisma.parcelsOrderByWithRelationInput>;

type OrderSortColumn = (typeof ORDER_SORT_COLUMNS)[OrderSortField];
type SortDirection = "asc" | "desc";

function resolveSortColumn(query: ListOrdersQuery): OrderSortColumn {
  return query.sortBy ? ORDER_SORT_COLUMNS[query.sortBy] : "order_number";
}

// The id tiebreaker makes the sort total, so keyset cursors are unambiguous
// even when the sort column has duplicate values.
function buildOrdersOrderBy(
  column: OrderSortColumn,
  direction: SortDirection,
): Prisma.parcelsOrderByWithRelationInput[] {
  // Cast: TS widens a computed union key to an index signature, but column is
  // allow-listed via ORDER_SORT_COLUMNS so the shape is guaranteed valid.
  return [{ [column]: direction } as Prisma.parcelsOrderByWithRelationInput, { id: direction }];
}

// ── Keyset (cursor) pagination ───────────────────────────────────────────────
// OFFSET pagination reads and discards every skipped row (page 500 scans 5 000
// rows) and skips/duplicates rows when data shifts between requests. A keyset
// cursor instead pins the boundary row's (sort value, id) and each page seeks
// straight to it through the index.

interface OrdersCursor {
  // Sort-column value serialized as a string (exact for ints, decimals,
  // strings and enum labels - see ORDER_SORT_COLUMNS for why timestamps are
  // never used here).
  v: string;
  id: string;
}

function encodeOrdersCursor(cursor: OrdersCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

// Malformed or tampered cursors degrade to "no cursor" (first page), never a 500.
function decodeOrdersCursor(raw: string | undefined): OrdersCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed.v === "string" && typeof parsed.id === "string") {
      return { v: parsed.v, id: parsed.id };
    }
  } catch {
    // fall through
  }
  return null;
}

function serializeSortValue(
  parcel: { order_number: number; cod_amount: Prisma.Decimal; delivery_charge: Prisma.Decimal; tracking_id: string; status: parcel_status },
  column: OrderSortColumn,
): string {
  switch (column) {
    case "order_number":
      return String(parcel.order_number);
    case "cod_amount":
      return parcel.cod_amount.toString();
    case "delivery_charge":
      return parcel.delivery_charge.toString();
    case "tracking_id":
      return parcel.tracking_id;
    case "status":
      return parcel.status;
  }
}

// Postgres orders enum columns by their definition order, which the generated
// parcel_status object preserves - so "values after X" is a slice of this list.
const STATUS_ENUM_ORDER = Object.values(parcel_status);

// Row-value comparison expanded for Prisma: (col, id) > (v, id) becomes
// col > v OR (col = v AND id > id). Returns null when the cursor value can't
// be interpreted for this column (e.g. sort changed since it was issued).
function buildKeysetCondition(
  column: OrderSortColumn,
  direction: SortDirection,
  cursor: OrdersCursor,
): Prisma.parcelsWhereInput | null {
  const idTie: Prisma.parcelsWhereInput =
    direction === "asc" ? { id: { gt: cursor.id } } : { id: { lt: cursor.id } };

  if (column === "status") {
    const index = STATUS_ENUM_ORDER.indexOf(cursor.v as parcel_status);
    if (index === -1) return null;
    const beyond =
      direction === "asc"
        ? STATUS_ENUM_ORDER.slice(index + 1)
        : STATUS_ENUM_ORDER.slice(0, index);
    return {
      OR: [
        ...(beyond.length ? [{ status: { in: beyond } }] : []),
        { AND: [{ status: cursor.v as parcel_status }, idTie] },
      ],
    };
  }

  let value: number | string;
  if (column === "order_number") {
    value = Number(cursor.v);
    if (!Number.isSafeInteger(value)) return null;
  } else if (column === "cod_amount" || column === "delivery_charge") {
    // Decimal columns accept their exact string form, but reject anything
    // non-numeric (e.g. a stale cursor issued under a different sort).
    if (!/^-?\d+(\.\d+)?$/.test(cursor.v)) return null;
    value = cursor.v;
  } else {
    value = cursor.v;
  }

  // Casts: TS widens computed union keys to index signatures; column is
  // allow-listed via ORDER_SORT_COLUMNS so the shapes are guaranteed valid.
  const strict = {
    [column]: direction === "asc" ? { gt: value } : { lt: value },
  } as Prisma.parcelsWhereInput;
  const equal = { [column]: value } as Prisma.parcelsWhereInput;

  return {
    OR: [strict, { AND: [equal, idTie] }],
  };
}

export async function listOrders(
  actor: OrderActor,
  query: ListOrdersQuery = {},
): Promise<ListOrdersResult> {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");
  // Own-vendor scope is set only for vendor / vendor_staff actors - never for
  // staff, sales or riders viewing the same parcels.
  const isOwnVendorViewer = !!vendorId;
  const where = buildOrdersWhere({ vendorId, vendorIds, riderId }, query);
  const sortColumn = resolveSortColumn(query);
  const sortDirection: SortDirection = query.sortDir === "asc" ? "asc" : "desc";
  const orderBy = buildOrdersOrderBy(sortColumn, sortDirection);

  // Pagination only kicks in when the caller explicitly asks for it, so
  // existing callers that expect a flat array keep working unchanged.
  const paginated =
    query.page !== undefined || query.pageSize !== undefined ||
    query.cursor !== undefined || query.dir !== undefined;

  // Most pages (OrderManagement, DispatchOperations, PickupOperations, ...)
  // call listOrders() with no filters at all and reload on every status-change
  // event - that's the only shape worth caching, since filtered/paginated
  // queries have too many distinct combinations to get useful hit rates.
  // Sales scope (vendorIds) is per-account and would collide with the shared
  // global cache key, so those queries skip the cache. A custom sort isn't
  // encoded in the cache key either, so it also has to skip the cache.
  // `trashed` is excluded too: it isn't part of the cache key, so without this
  // a trash listing would both read and overwrite the live orders cache.
  const isDefaultUnfilteredQuery =
    !paginated && !query.status?.length && !query.orderType && !query.search &&
    !query.vendorId?.length && !query.deliveryRiderId && !query.sortBy &&
    !query.deliveredToday && !query.trashed && vendorIds === undefined;
  // Export requests (withArrival) skip the shared cache so the enriched rows
  // never pollute the lean list cache and vice-versa.
  const cacheKey =
    isDefaultUnfilteredQuery && !query.withArrival ? ordersListCacheKey(vendorId, riderId) : null;

  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error("[Redis] Failed to read orders list cache:", error);
    }
  }

  if (!paginated) {
    const DEFAULT_LIST_CAP = 200;
    const [total, parcels] = await Promise.all([
      prisma.parcels.count({ where }),
      prisma.parcels.findMany({
        where,
        include: ORDERS_INCLUDE,
        orderBy,
        take: DEFAULT_LIST_CAP,
      }),
    ]);
    const arrivedMap = query.withArrival
      ? await fetchArrivedAtOriginMap(parcels.map((p) => p.id))
      : undefined;
    const result: ListOrdersResult = {
      data: parcels.map((p) => mapOrder(p, isStaff, isOwnVendorViewer, arrivedMap)),
      meta: {
        page: 1,
        pageSize: DEFAULT_LIST_CAP,
        total,
        totalPages: Math.max(1, Math.ceil(total / DEFAULT_LIST_CAP)),
        truncated: total > DEFAULT_LIST_CAP,
      },
    };

    if (cacheKey) {
      try {
        await redis.setex(cacheKey, ORDERS_LIST_TTL_SECONDS, JSON.stringify(result));
      } catch (error) {
        console.error("[Redis] Failed to write orders list cache:", error);
      }
    }

    return result;
  }

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize || DEFAULT_PAGE_SIZE));
  const dir: "next" | "prev" = query.dir === "prev" ? "prev" : "next";
  const cursor = decodeOrdersCursor(query.cursor);

  // Walking backwards ("prev") flips the sort for the fetch and un-flips the
  // rows afterwards; "prev with no cursor" means jump to the last page.
  const fetchDirection: SortDirection =
    dir === "prev" ? (sortDirection === "asc" ? "desc" : "asc") : sortDirection;
  const fetchOrderBy = buildOrdersOrderBy(sortColumn, fetchDirection);

  const keysetCondition = cursor
    ? buildKeysetCondition(sortColumn, fetchDirection, cursor)
    : null;
  const effectiveCursor = keysetCondition ? cursor : null;
  const keysetWhere: Prisma.parcelsWhereInput = keysetCondition
    ? { AND: [where, keysetCondition] }
    : where;

  let total: number;
  let parcels: Prisma.parcelsGetPayload<{ include: typeof ORDERS_INCLUDE }>[];
  let hasMore: boolean;

  if (dir === "prev" && !effectiveCursor) {
    // Last-page jump: fetch from the end, sized so page boundaries stay
    // aligned with forward navigation (needs the count first).
    total = await prisma.parcels.count({ where });
    const lastPageSize = total % pageSize || pageSize;
    parcels = await prisma.parcels.findMany({
      where: keysetWhere,
      include: ORDERS_INCLUDE,
      orderBy: fetchOrderBy,
      take: lastPageSize,
    });
    hasMore = total > parcels.length;
  } else {
    // Fetch one extra row purely to learn whether another page exists.
    [total, parcels] = await Promise.all([
      prisma.parcels.count({ where }),
      prisma.parcels.findMany({
        where: keysetWhere,
        include: ORDERS_INCLUDE,
        orderBy: fetchOrderBy,
        take: pageSize + 1,
      }),
    ]);
    hasMore = parcels.length > pageSize;
    if (hasMore) parcels = parcels.slice(0, pageSize);
  }

  if (fetchDirection !== sortDirection) parcels.reverse();

  const hasNextPage = dir === "next" ? hasMore : effectiveCursor !== null;
  const hasPrevPage = dir === "prev" ? hasMore : effectiveCursor !== null;

  const firstRow = parcels[0];
  const lastRow = parcels[parcels.length - 1];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageHint =
    dir === "prev" && !effectiveCursor
      ? totalPages
      : Math.min(totalPages, Math.max(1, query.page || 1));

  return {
    data: parcels.map((p) => mapOrder(p, isStaff, isOwnVendorViewer)),
    meta: {
      page: pageHint,
      pageSize,
      total,
      totalPages,
      hasNextPage,
      hasPrevPage,
      nextCursor:
        hasNextPage && lastRow
          ? encodeOrdersCursor({ v: serializeSortValue(lastRow, sortColumn), id: lastRow.id })
          : null,
      prevCursor:
        hasPrevPage && firstRow
          ? encodeOrdersCursor({ v: serializeSortValue(firstRow, sortColumn), id: firstRow.id })
          : null,
    },
  };
}

// ── Rider run sheet ───────────────────────────────────────────────────────────
// Run sheets are persisted hand-off records (see createRunSheet): one sheet per
// batch of parcels sent out for delivery with a rider. This lists the sheets
// for one Nepal-local day, with delivery progress read off the member parcels.

// The parcel shape every hand-off document needs: who it goes to, where, how
// heavy, how much cash. Shared by the run sheet (delivery leg) and the return
// manifest (RTO leg) - both list the same columns for the same reason, so they
// read the same rows rather than each growing their own near-copy.
export const HANDOVER_PARCEL_INCLUDE = {
  parties_parcels_receiver_idToparties: true,
  locations_parcels_destination_location_idTolocations: true,
  vendors: true,
  // Newest remark only. The hand-over sheet prints it in the Remarks column, so
  // whoever signs for the parcel reads the same note the ops list shows - see
  // mapOrder, which takes the latest the same way.
  parcel_remarks: {
    orderBy: { created_at: "desc" as const },
    take: 1,
  },
} satisfies Prisma.parcelsInclude;

type HandoverParcel = Prisma.parcelsGetPayload<{ include: typeof HANDOVER_PARCEL_INCLUDE }>;

export function mapHandoverParcel(parcel: HandoverParcel) {
  const receiver = parcel.parties_parcels_receiver_idToparties;
  return {
    id: parcel.id,
    orderNumber: parcel.order_number,
    trackingId: parcel.tracking_id,
    status: parcel.status,
    receiverName: receiver.name,
    receiverPhone: receiver.phone,
    address:
      receiver.address ||
      locationName(parcel.locations_parcels_destination_location_idTolocations) ||
      "",
    destination:
      locationName(parcel.locations_parcels_destination_location_idTolocations) ||
      receiver.address ||
      "",
    pieces: parcel.pieces,
    weightKg: parcel.weight_kg === null ? undefined : Number(parcel.weight_kg),
    codAmount: Number(parcel.cod_amount),
    vendorName: parcel.vendors?.business_name || parcel.vendors?.client_name || "",
    // The carrier-staff tag is internal bookkeeping (see utils/carrierRemark):
    // it marks an inbound comment's origin and must never reach a printed sheet.
    remarks: stripCarrierStaffTag(parcel.parcel_remarks[0]?.remark || "").text,
    deliveryInstruction: parcel.delivery_instruction || "",
    deliveredAt: parcel.delivered_at ? parcel.delivered_at.toISOString() : null,
  };
}

export type HandoverParcelDto = ReturnType<typeof mapHandoverParcel>;

const DAY_MS = 24 * 60 * 60 * 1000;

// Today's calendar date in Nepal local time (YYYY-MM-DD).
function nepalToday(): string {
  return new Date(Date.now() + NEPAL_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

// UTC instant range covering one Nepal-local calendar day.
function nepalDayWindow(date: string) {
  const start = new Date(Date.parse(`${date}T00:00:00Z`) - NEPAL_UTC_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export async function getRiderRunSheet(
  query: { riderId?: string; date?: string } = {},
) {
  const date = query.date || nepalToday();
  const { start, end } = nepalDayWindow(date);
  if (Number.isNaN(start.getTime())) {
    throw new AppError(400, "Invalid date");
  }

  const sheets = await prisma.run_sheets.findMany({
    where: {
      created_at: { gte: start, lt: end },
      ...(query.riderId ? { rider_id: query.riderId } : {}),
    },
    include: {
      riders: { include: { locations: true } },
      run_sheet_parcels: {
        include: { parcels: { include: HANDOVER_PARCEL_INCLUDE } },
        orderBy: { created_at: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
    // Safety valve only - one day of hand-offs is inherently small.
    take: 500,
  });

  const mapped = sheets.map((sheet) => {
    const parcels = sheet.run_sheet_parcels.map((link) => mapHandoverParcel(link.parcels));
    const delivered = parcels.filter((p) => p.status === "delivered" || p.status === "partially_delivered");
    // Latest movement on the sheet = the newest status change among its parcels.
    const lastParcelUpdate = sheet.run_sheet_parcels.reduce<Date | null>(
      (latest, link) =>
        !latest || link.parcels.updated_at > latest ? link.parcels.updated_at : latest,
      null,
    );

    return {
      id: sheet.id,
      sheetNo: sheet.sheet_no,
      rider: {
        id: sheet.riders.id,
        name: sheet.riders.name,
        phone: sheet.riders.phone,
        vehicleNo: sheet.riders.vehicle_no || "",
        hub: sheet.riders.locations?.name || sheet.riders.rider_location || "",
      },
      createdAt: sheet.created_at.toISOString(),
      updatedAt: (lastParcelUpdate && lastParcelUpdate > sheet.created_at
        ? lastParcelUpdate
        : sheet.created_at
      ).toISOString(),
      totalItems: parcels.length,
      deliveredItems: delivered.length,
      failedItems: parcels.filter((p) => p.status === "failed_delivery").length,
      outItems: parcels.filter((p) => p.status === "sent_for_delivery").length,
      totalCod: parcels.reduce((sum, p) => sum + p.codAmount, 0),
      codCollected: delivered.reduce((sum, p) => sum + p.codAmount, 0),
      parcels,
    };
  });

  return {
    date,
    summary: {
      totalSheets: mapped.length,
      totalItems: mapped.reduce((sum, s) => sum + s.totalItems, 0),
      deliveredItems: mapped.reduce((sum, s) => sum + s.deliveredItems, 0),
      outItems: mapped.reduce((sum, s) => sum + s.outItems, 0),
      totalCod: mapped.reduce((sum, s) => sum + s.totalCod, 0),
    },
    sheets: mapped,
  };
}

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

// Internal staff whose real names must never surface to vendors/riders - their
// remarks and status changes are attributed to a generic "Staff" instead.
const STAFF_ROLE_CODES = new Set(["super_admin", "admin"]);

// NCM 3PL bookkeeping remarks. The handoff remark is an internal audit/link
// row (see ncm.service.ts) and must not show in the user-facing thread.
// Inbound carrier-staff comments carry a bracketed tag we strip for display,
// attributing them to a generic "Staff" (they have no local user). See
// utils/carrierRemark.ts - the tag spelling lives there so it cannot drift
// away from what ncm.service.ts actually writes.
const NCM_HANDOFF_PREFIX = "[NCM] Handed off";

function isStaffAuthor(
  user: { user_roles?: { roles: { code: string } }[] } | null | undefined,
): boolean {
  return !!user?.user_roles?.some((ur) => STAFF_ROLE_CODES.has(ur.roles.code));
}

export async function getOrderByTrackingId(actor: OrderActor, trackingId: string) {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");

  const parcel = await prisma.parcels.findFirst({
    where: {
      tracking_id: trackingId,
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
      ...(riderId ? riderHandledFilter(riderId) : {}),
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

  return {
    ...mapOrder(parcel, isStaff, !!vendorId),
    canChangeStatus: isStaff,
    priceLog,
    redirectLog,
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
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);

  const parcels = await prisma.parcels.findMany({
    where: {
      tracking_id: { in: trackingIds },
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
      ...(riderId ? riderHandledFilter(riderId) : {}),
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

  const { vendorId, vendorIds, riderId } = await getActorScope(actor);

  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
      ...(riderId ? riderHandledFilter(riderId) : {}),
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
  void import("./ncm.service").then(({ syncRemarkToNcm }) =>
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

export async function getDashboardSummary(actor: OrderActor, trendDays: 7 | 30 = 7) {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);
  const cacheKey =
    vendorIds === undefined
      ? dashboardSummaryCacheKey(vendorId, riderId, trendDays)
      : vendorIds.length > 0
      ? salesDashboardSummaryCacheKey(vendorIds, trendDays)
      : null;

  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error("[Redis] Failed to read dashboard summary cache:", error);
    }
  }

  return dedupeInFlight(cacheKey, () => computeDashboardSummary(trendDays, vendorId, vendorIds, riderId, cacheKey));
}

async function computeDashboardSummary(
  trendDays: 7 | 30,
  vendorId: string | undefined,
  vendorIds: string[] | undefined,
  riderId: string | undefined,
  cacheKey: string | null,
) {
  // Start of today in Nepal local time. setHours() would truncate to the *host*
  // timezone, and the production container runs UTC - so every day bucket below
  // (the trend graph included) started 5h45m late, filing anything that happened
  // between midnight and 05:45 NPT under the previous day.
  const todayStart = new Date(
    Date.parse(`${formatDate(new Date())}T00:00:00Z`) - NEPAL_UTC_OFFSET_MS,
  );

  const parcelWhere: Prisma.parcelsWhereInput = {
    deleted_at: null,
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    ...(riderId ? riderHandledFilter(riderId) : {}),
  };

  const codWhere: Prisma.cod_collectionsWhereInput = {
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    ...(riderId ? { rider_id: riderId } : {}),
  };

  // The COD Settlement card counts every delivered / partially-delivered
  // order, all-time - not a rolling window, since "pending" is money still
  // owed and must never silently drop off just because it's old. To keep the
  // math honest across partial deliveries - where the declared cod_amount
  // overstates what was actually collected - every figure is anchored on
  // collected_amount (the cash actually in hand), and the settled legs are
  // clamped with LEAST() so a settlement can never exceed what was collected.
  // Pending is then collected - settled, so Settled + Pending always equals
  // Total exactly.
  const codScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND c.vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND c.vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? Prisma.sql`AND c.rider_id = ${riderId}::uuid`
    : Prisma.empty;

  const settlementWhere: Prisma.settlementsWhereInput = {
    status: "settled",
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    ...(riderId ? { rider_id: riderId } : {}),
  };

  const TREND_DAYS = trendDays;
  const trendDayRanges = Array.from({ length: TREND_DAYS }, (_, index) => {
    const offset = TREND_DAYS - 1 - index;
    const start = new Date(todayStart);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  });

  // "Delivered" on the rider dashboard is a claim about who handed the parcel
  // over, not merely who touched it - so for a rider it counts only their own
  // deliveries. Without this a 3PL delivery (delivery_rider_id NULL) was filed
  // under whichever rider had collected the parcel days earlier, and riders
  // reported NCM "delivering in their name". Empty for vendor/staff/sales
  // scopes, which are not making that claim.
  const riderDeliveredSql: Prisma.Sql = riderId
    ? Prisma.sql`AND delivery_rider_id = ${riderId}::uuid`
    : Prisma.empty;

  // Every card on the rider dashboard deep-links to the list of orders behind
  // it, so a card whose number is computed on different terms than its own
  // drill-down is simply wrong - a rider taps "Total Picked Up: 340" and lands
  // on three rows. The list is fixed at a status set (the rider APK is
  // sideloaded and can't be updated), so the number is what has to move.
  //
  // Picked Up -> ?view=picked_up, which lists status = picked_up. For that
  // status custody and handled scope agree, so no extra rider predicate is
  // needed. The card stops being a lifetime tally and becomes "collected, not
  // yet handed over at the hub" - which is the honest reading of a number you
  // can tap into, and matches the Pickup lane riders already work from.
  const pickedUpFilterSql: Prisma.Sql = riderId
    ? Prisma.sql`status::text = 'picked_up'`
    : Prisma.sql`status::text NOT IN ('pickup_ordered','rider_assigned','failed_pickup','cancelled')`;

  // Total RTV -> ?view=return, which lists sent_to_vendor/returned_to_vendor.
  // order_type = 'return' is a different question entirely (it counts return
  // orders at any status, including ones this rider never carried back), so
  // for a rider it's replaced by the statuses the list actually shows, scoped
  // the same way custody scopes them: the rider who carried the return.
  const returnsFilterSql: Prisma.Sql = riderId
    ? Prisma.sql`status::text = ANY(ARRAY['sent_to_vendor','returned_to_vendor']) AND delivery_rider_id = ${riderId}::uuid`
    : Prisma.sql`order_type::text = 'return'`;

  // Same scope (vendor/rider/none) as parcelWhere above, expressed as raw SQL so
  // it can be reused across both consolidated queries below. Casting the enum
  // columns to text and comparing against plain string arrays sidesteps
  // Postgres enum-array parameter binding, which $queryRaw doesn't infer well.
  const parcelScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? riderHandledSql(riderId)
    : Prisma.empty;

  // The 11 overview/today metrics below all count the same `parcels` table
  // under the same scope, differing only in which status/date predicate
  // applies - conditional aggregation collapses them into one round trip
  // instead of 11. (Previously the single biggest contributor to this
  // endpoint's ~17-query fan-out under load - see server/loadtest/README.md.)
  const [overviewRow] = await prisma.$queryRaw<
    Array<{
      total_orders: bigint;
      pending_pickups: bigint;
      pending_returns: bigint;
      in_transit: bigint;
      pending_deliveries: bigint;
      awaiting_pickup: bigint;
      in_delivery: bigint;
      total_delivered: bigint;
      total_picked_up: bigint;
      total_returns: bigint;
      total_returned_to_vendor: bigint;
      todays_orders: bigint;
      todays_delivered: bigint;
      todays_returns: bigint;
      total_order_amount: string;
      pending_pickups_amount: string;
      pending_returns_amount: string;
      in_transit_amount: string;
      pending_deliveries_amount: string;
      awaiting_pickup_amount: string;
      in_delivery_amount: string;
      todays_delivered_amount: string;
      total_delivered_amount: string;
      total_returns_amount: string;
      total_returned_to_vendor_amount: string;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE status::text = ANY(${PICKUP_PENDING_STATUSES})) AS pending_pickups,
      COUNT(*) FILTER (WHERE status::text = ANY(${RETURN_PENDING_STATUSES})) AS pending_returns,
      COUNT(*) FILTER (WHERE status::text = ANY(${IN_TRANSIT_STATUSES})) AS in_transit,
      COUNT(*) FILTER (WHERE status::text = ANY(${DELIVERY_PENDING_STATUSES})) AS pending_deliveries,
      COUNT(*) FILTER (WHERE status::text = ANY(${AWAITING_PICKUP_STATUSES})) AS awaiting_pickup,
      COUNT(*) FILTER (WHERE status::text = ANY(${IN_DELIVERY_STATUSES})) AS in_delivery,
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) ${riderDeliveredSql}) AS total_delivered,
      COUNT(*) FILTER (WHERE ${pickedUpFilterSql}) AS total_picked_up,
      COUNT(*) FILTER (WHERE ${returnsFilterSql}) AS total_returns,
      COUNT(*) FILTER (WHERE status::text = 'returned_to_vendor') AS total_returned_to_vendor,
      COUNT(*) FILTER (WHERE created_at >= ${todayStart}) AS todays_orders,
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${todayStart} ${riderDeliveredSql}) AS todays_delivered,
      COUNT(*) FILTER (WHERE order_type::text = 'return' AND created_at >= ${todayStart}) AS todays_returns,
      COALESCE(SUM(cod_amount), 0) AS total_order_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${PICKUP_PENDING_STATUSES})), 0) AS pending_pickups_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${RETURN_PENDING_STATUSES})), 0) AS pending_returns_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${IN_TRANSIT_STATUSES})), 0) AS in_transit_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${DELIVERY_PENDING_STATUSES})), 0) AS pending_deliveries_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${AWAITING_PICKUP_STATUSES})), 0) AS awaiting_pickup_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${IN_DELIVERY_STATUSES})), 0) AS in_delivery_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${todayStart} ${riderDeliveredSql}), 0) AS todays_delivered_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) ${riderDeliveredSql}), 0) AS total_delivered_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE ${returnsFilterSql}), 0) AS total_returns_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = 'returned_to_vendor'), 0) AS total_returned_to_vendor_amount
    FROM parcels
    WHERE deleted_at IS NULL ${parcelScopeSql}
  `);

  const totalOrders = Number(overviewRow!.total_orders);
  const pendingPickups = Number(overviewRow!.pending_pickups);
  const pendingReturns = Number(overviewRow!.pending_returns);
  const inTransit = Number(overviewRow!.in_transit);
  const pendingDeliveries = Number(overviewRow!.pending_deliveries);
  const awaitingPickup = Number(overviewRow!.awaiting_pickup);
  const inDelivery = Number(overviewRow!.in_delivery);
  const totalDelivered = Number(overviewRow!.total_delivered);
  const totalPickedUp = Number(overviewRow!.total_picked_up);
  const totalReturns = Number(overviewRow!.total_returns);
  const totalReturnedToVendor = Number(overviewRow!.total_returned_to_vendor);
  const todaysOrders = Number(overviewRow!.todays_orders);
  const todaysDelivered = Number(overviewRow!.todays_delivered);
  const todaysReturns = Number(overviewRow!.todays_returns);
  const totalOrderAmount = Number(overviewRow!.total_order_amount);
  const pendingPickupsAmount = Number(overviewRow!.pending_pickups_amount);
  const pendingReturnsAmount = Number(overviewRow!.pending_returns_amount);
  const inTransitAmount = Number(overviewRow!.in_transit_amount);
  const pendingDeliveriesAmount = Number(overviewRow!.pending_deliveries_amount);
  const awaitingPickupAmount = Number(overviewRow!.awaiting_pickup_amount);
  const inDeliveryAmount = Number(overviewRow!.in_delivery_amount);
  const todaysDeliveredAmount = Number(overviewRow!.todays_delivered_amount);
  const totalDeliveredAmount = Number(overviewRow!.total_delivered_amount);
  const totalReturnsAmount = Number(overviewRow!.total_returns_amount);
  const totalReturnedToVendorAmount = Number(overviewRow!.total_returned_to_vendor_amount);

  // Same consolidation for the weekly/monthly trend: previously 4 queries per
  // day (up to 120 for the 30-day view), now one query with 4 conditional
  // aggregates per day. Column aliases are loop-index-derived, never
  // user-supplied, so Prisma.raw here isn't an injection risk.
  const trendSelects = trendDayRanges.map(({ start, end }, i) => Prisma.sql`
    COUNT(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS ${Prisma.raw(`d${i}_total`)},
    COUNT(*) FILTER (WHERE picked_up_at >= ${start} AND picked_up_at < ${end}) AS ${Prisma.raw(`d${i}_picked_up`)},
    COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${start} AND delivered_at < ${end}) AS ${Prisma.raw(`d${i}_delivered`)},
    COUNT(*) FILTER (WHERE order_type::text = 'return' AND created_at >= ${start} AND created_at < ${end}) AS ${Prisma.raw(`d${i}_returned`)}
  `);
  const [trendRow] = await prisma.$queryRaw<Array<Record<string, bigint>>>(Prisma.sql`
    SELECT ${Prisma.join(trendSelects, ",")} FROM parcels WHERE deleted_at IS NULL ${parcelScopeSql}
  `);
  const trendCounts = trendDayRanges.map((_, i) => [
    Number(trendRow![`d${i}_total`]),
    Number(trendRow![`d${i}_picked_up`]),
    Number(trendRow![`d${i}_delivered`]),
    Number(trendRow![`d${i}_returned`]),
  ]);

  // Same scope as parcelScopeSql but qualified for the `p` alias, so it can be
  // reused in joins against parcel_status_history below.
  const pAliasScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND p.vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND p.vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? riderHandledSql(riderId, "p.")
    : Prisma.empty;

  const [todaysRemarks, unclosedComments, codRows, pendingCodCount, lastSettlement, returnedTodayRows] = await Promise.all([
    prisma.parcel_remarks.count({
      where: { created_at: { gte: todayStart }, parcels: parcelWhere },
    }),
    // Same set as the nav's "Unclosed cmt" badge - this row links to the vendor
    // queue, so it counts what that page lists. Rider-raised remarks are the
    // separate "Rider cmt" queue.
    prisma.parcel_remarks.count({
      where: { ...unclosedRemarksWhere("vendor"), parcels: parcelWhere },
    }),
    prisma.$queryRaw<
      Array<{
        total_collected: string;
        settled_to_vendor: string;
        settled_to_rider: string;
        cod_from_pm_rider: string;
        cod_from_ncm: string;
        cod_from_upaya: string;
        pending_delivery_charge: string;
        total_delivery_charge: string;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(c.collected_amount), 0) AS total_collected,
        COALESCE(SUM(LEAST(c.remitted_amount, c.collected_amount)), 0) AS settled_to_vendor,
        COALESCE(SUM(LEAST(c.rider_remitted_amount, c.collected_amount)), 0) AS settled_to_rider,
        -- Cash a ParcelMoover rider physically holds, not yet remitted to the
        -- office: c.rider_id is only ever set from parcels.delivery_rider_id,
        -- which stays NULL for NCM-delivered parcels (see
        -- applyExternalCarrierStatus) - so rider_id IS NOT NULL is exactly
        -- "our own rider delivered this," never an NCM handoff. r.carrier_code
        -- IS NULL excludes placeholder rider rows that stand in for a carrier
        -- (e.g. "PM Rider U"/"PM Rider N") rather than a real employee.
        COALESCE(SUM(c.collected_amount - LEAST(c.rider_remitted_amount, c.collected_amount))
          FILTER (WHERE c.rider_id IS NOT NULL AND r.carrier_code IS NULL), 0) AS cod_from_pm_rider,
        -- Cash NCM collected on our behalf and hasn't remitted to the office
        -- yet. Two signals feed this: the durable API handoff remark
        -- ncm.service.ts writes (see findNcmOrderIdForParcel), and parcels
        -- routed to NCM manually via the "PM Rider N" placeholder rider
        -- (r.carrier_code = 'ncm') for cases the API flow doesn't cover. No
        -- pm-rider ever touches this cash, so rider_remitted_amount is never
        -- populated for these rows - the full collected amount counts as
        -- outstanding until NCM's remittance clears it (via the vendor leg,
        -- remitted_amount).
        COALESCE(SUM(c.collected_amount - LEAST(c.remitted_amount, c.collected_amount))
          FILTER (WHERE (c.rider_id IS NULL AND EXISTS (
            SELECT 1 FROM parcel_remarks pr
            WHERE pr.parcel_id = p.id AND pr.remark LIKE ${NCM_HANDOFF_REMARK_PREFIX + '%'}
          )) OR r.carrier_code = 'ncm'), 0) AS cod_from_ncm,
        -- Cash Upaya collected on our behalf. Two signals, same shape as NCM
        -- above: the durable API handoff remark upaya.service.ts writes for
        -- real API-driven handoffs, and the "PM Rider U" placeholder rider
        -- (r.carrier_code = 'upaya') for parcels routed to Upaya manually,
        -- from before the API integration existed. Same "clears via the
        -- vendor leg" reasoning as NCM above.
        COALESCE(SUM(c.collected_amount - LEAST(c.remitted_amount, c.collected_amount))
          FILTER (WHERE (c.rider_id IS NULL AND EXISTS (
            SELECT 1 FROM parcel_remarks pr
            WHERE pr.parcel_id = p.id AND pr.remark LIKE ${UPAYA_HANDOFF_REMARK_PREFIX + '%'}
          )) OR r.carrier_code = 'upaya'), 0) AS cod_from_upaya,
        COALESCE(SUM(p.delivery_charge) FILTER (WHERE c.payment_status::text = 'pending'), 0) AS pending_delivery_charge,
        COALESCE(SUM(p.delivery_charge), 0) AS total_delivery_charge
      FROM cod_collections c
      JOIN parcels p ON p.id = c.parcel_id
      LEFT JOIN riders r ON r.id = c.rider_id
      WHERE p.deleted_at IS NULL
        AND p.status::text IN ('delivered', 'partially_delivered')
        ${codScopeSql}
    `),
    prisma.cod_collections.count({
      where: riderId
        ? { ...codWhere, rider_payment_status: "pending", collected_amount: { gt: 0 } }
        : { ...codWhere, payment_status: "pending" },
    }),
    prisma.settlements.findFirst({
      where: settlementWhere,
      orderBy: [{ settlement_date: "desc" }, { created_at: "desc" }],
      select: { amount: true, payable_amount: true, settlement_date: true, created_at: true },
    }),
    // Parcels whose status *became* returned_to_vendor today (by status-history
    // timestamp, since parcels has no returned_at column). DISTINCT guards
    // against a parcel bouncing into the status more than once in a day.
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT h.parcel_id) AS count
      FROM parcel_status_history h
      JOIN parcels p ON p.id = h.parcel_id
      WHERE h.new_status::text = 'returned_to_vendor'
        AND h.created_at >= ${todayStart}
        AND p.deleted_at IS NULL
        ${pAliasScopeSql}
    `),
  ]);
  const todaysReturnedToVendor = Number(returnedTodayRows[0]?.count ?? 0);

  // All figures are on the collected-cash basis (see codScopeSql above). Total
  // is the cash actually collected; settled is what has been remitted onward
  // (to the vendor for vendor/staff scope, to the office for rider scope),
  // clamped in SQL so it can't exceed the collection; pending is the remainder.
  const codRow = codRows[0];
  const totalCod = Number(codRow?.total_collected ?? 0);
  const settledCod = riderId
    ? Number(codRow?.settled_to_rider ?? 0)
    : Number(codRow?.settled_to_vendor ?? 0);
  const pendingCod = Math.max(totalCod - settledCod, 0);

  // Cash currently outstanding, split by who's holding it - shown on the
  // dashboard card under one "COD to collect from riders" heading, broken
  // down by carrier beneath it. NCM's figure is a proxy (no NCM
  // remittance-to-office column exists): it clears the moment the vendor leg
  // settles, same as the rest of "pending" does. The parent total is the sum
  // of the identified carriers, not an independent all-rider_id-null figure -
  // that keeps every level using the same accurate per-carrier formula (a
  // future 3PL just adds another FILTER clause and another addend here).
  const codFromPmRider = Number(codRow?.cod_from_pm_rider ?? 0);
  const codFromNcm = Number(codRow?.cod_from_ncm ?? 0);
  const codFromUpaya = Number(codRow?.cod_from_upaya ?? 0);
  const codFromRiders = codFromPmRider + codFromNcm + codFromUpaya;

  // Delivery charge on orders whose COD hasn't been settled to the vendor
  // yet - this is deducted from collected_amount at settlement time (see
  // finance.service.ts's payableAmount calc), so it's still "owed" until then.
  const pendingDeliveryCharge = Number(codRow?.pending_delivery_charge ?? 0);
  // Total delivery charges (the office's cut) on the same delivered orders the
  // COD figures above are drawn from - shown as its own line on the COD card.
  const deliveryCharge = Number(codRow?.total_delivery_charge ?? 0);

  const weeklyTrend = trendDayRanges.map(({ start }, index) => {
    const [dayTotalOrders, dayPickedUp, dayDelivered, dayReturned] = trendCounts[index] ?? [0, 0, 0, 0];
    return {
      day: start.toLocaleDateString("en-US", { weekday: "short" }),
      date: formatDate(start),
      totalOrders: dayTotalOrders,
      pickedUp: dayPickedUp,
      delivered: dayDelivered,
      returned: dayReturned,
    };
  });

  // ── SLA breaches ────────────────────────────────────────────────────────────
  // An order breaches its SLA when the time since it *entered its current status*
  // (latest parcel_status_history row, falling back to created_at) exceeds the
  // hours configured for that status. Counts are scoped like everything else.
  const slaSettings = await getSlaSettings();
  const statusThresholds: Array<[string, number]> = [];
  for (const status of [
    ...SLA_GROUPS.pickup,
    ...SLA_GROUPS.delivery,
    ...SLA_GROUPS.transit,
    ...SLA_GROUPS.return,
  ]) {
    const hours = slaSettings[status];
    if (typeof hours === "number") statusThresholds.push([status, hours]);
  }

  const slaCounts: Record<string, number> = {};
  if (statusThresholds.length) {
    const breachColumns = statusThresholds.map(([status, hours]) =>
      Prisma.sql`COUNT(*) FILTER (
        WHERE status::text = ${status}
          AND COALESCE(
            (SELECT MAX(h.created_at) FROM parcel_status_history h WHERE h.parcel_id = parcels.id),
            created_at
          ) < now() - (${hours} * interval '1 hour')
      ) AS ${Prisma.raw(`c_${status}`)}`,
    );
    const [row] = await prisma.$queryRaw<Array<Record<string, bigint>>>(Prisma.sql`
      SELECT ${Prisma.join(breachColumns)}
      FROM parcels
      WHERE deleted_at IS NULL ${parcelScopeSql}
    `);
    for (const [status] of statusThresholds) slaCounts[status] = Number(row?.[`c_${status}`] ?? 0);
  }

  const sumStatuses = (statuses: readonly string[]) =>
    statuses.reduce((n, s) => n + (slaCounts[s] ?? 0), 0);

  // The statuses behind a group's total, so "Pickup SLA breached: 3" can say
  // which stages those three are stuck in. Only the ones actually breaching -
  // a list padded with zeroes tells the reader nothing and crowds the row.
  const breachesByStatus = (statuses: readonly string[]) =>
    statuses
      .map((status) => ({ status, count: slaCounts[status] ?? 0 }))
      .filter((entry) => entry.count > 0);

  // Representative SLA threshold to display for a group row: the tightest
  // (smallest) configured hours among its statuses, or null if none set.
  const groupHours = (statuses: readonly string[]): number | null => {
    const vals = statuses
      .map((s) => slaSettings[s])
      .filter((h): h is number => typeof h === "number");
    return vals.length ? Math.min(...vals) : null;
  };

  let overdueRemarks = 0;
  const remarksHours = slaSettings["remarks"];
  if (typeof remarksHours === "number") {
    const remarksCutoff = new Date(Date.now() - remarksHours * 3600 * 1000);
    // Unclosed comments past their SLA - the same set the badge counts, aged.
    // Counting raw parcel_remarks rows instead swept in every reply as its own
    // breach, plus staff notes and the sync jobs' own bookkeeping rows, none of
    // which anyone is waiting to reply to and none of which are ever closed.
    // Both queues here, not just the vendor one: this row links to /remarks,
    // which lists them together.
    overdueRemarks = await prisma.parcel_remarks.count({
      where: {
        ...unclosedRemarksWhere(),
        // The clock runs from the last message in the thread, not from the one
        // that opened it: the row means "nobody has answered this in N hours",
        // so a reply is activity and restarts it. Root older than the cutoff
        // AND no reply since is the same test as "newest message is older than
        // the cutoff", without a correlated subquery.
        created_at: { lt: remarksCutoff },
        replies: { none: { created_at: { gte: remarksCutoff } } },
        parcels: parcelWhere,
      },
    });
  }

  const summary = {
    overview: {
      totalOrders,
      totalOrderAmount,
      pendingPickups,
      pendingPickupsAmount,
      pendingReturns,
      pendingReturnsAmount,
      inTransit,
      inTransitAmount,
      pendingDeliveries,
      pendingDeliveriesAmount,
      awaitingPickup,
      awaitingPickupAmount,
      inDelivery,
      inDeliveryAmount,
      totalDelivered,
      totalDeliveredAmount,
      totalPickedUp,
      totalReturns,
      totalReturnsAmount,
      totalReturnedToVendor,
      totalReturnedToVendorAmount,
    },
    today: {
      totalOrders: todaysOrders,
      delivered: todaysDelivered,
      deliveredAmount: todaysDeliveredAmount,
      inTransit,
      returns: todaysReturns,
      returnedToVendor: todaysReturnedToVendor,
      remarks: todaysRemarks,
      unclosedComments,
    },
    codSettlement: {
      totalCod,
      settledCod,
      pendingCod,
      codFromRiders,
      codFromPmRider,
      codFromNcm,
      codFromUpaya,
      deliveryCharge,
      pendingCodCount,
      pendingDeliveryCharge,
      progressPercent: totalCod > 0 ? (settledCod / totalCod) * 100 : 0,
      scopedToRider: Boolean(riderId),
      // Net amount the vendor was actually paid (collected COD minus delivery
      // charge - see finance.service.ts's payableAmount), not the gross total.
      lastAmount: lastSettlement ? moneyToNumber(lastSettlement.payable_amount ?? lastSettlement.amount) : 0,
      // Full timestamp, not just the (time-less) settlement_date column, so the
      // UI can show both date and time of when the settlement was created.
      lastSettledAt: lastSettlement ? lastSettlement.created_at.toISOString() : null,
    },
    sla: {
      overduePickup: sumStatuses(SLA_GROUPS.pickup),
      overdueDelivery: sumStatuses(SLA_GROUPS.delivery),
      overdueTransit: sumStatuses(SLA_GROUPS.transit),
      overdueRemarks,
      overdueReturn: sumStatuses(SLA_GROUPS.return),
      pickupHours: groupHours(SLA_GROUPS.pickup),
      deliveryHours: groupHours(SLA_GROUPS.delivery),
      transitHours: groupHours(SLA_GROUPS.transit),
      remarksHours: typeof slaSettings["remarks"] === "number" ? slaSettings["remarks"] : null,
      returnHours: groupHours(SLA_GROUPS.return),
      pickupBreaches: breachesByStatus(SLA_GROUPS.pickup),
      deliveryBreaches: breachesByStatus(SLA_GROUPS.delivery),
      transitBreaches: breachesByStatus(SLA_GROUPS.transit),
      returnBreaches: breachesByStatus(SLA_GROUPS.return),
    },
    weeklyTrend,
    updatedAt: new Date().toISOString(),
  };

  if (cacheKey) {
    try {
      await redis.setex(cacheKey, DASHBOARD_SUMMARY_TTL_SECONDS, JSON.stringify(summary));
    } catch (error) {
      console.error("[Redis] Failed to write dashboard summary cache:", error);
    }
  }

  return summary;
}

// ── COD settlement detail (drill-down from the dashboard card) ──────────────

export const COD_DETAIL_BUCKETS = [
  "total",
  "settled",
  "pending",
  "pm-rider",
  "ncm",
  "upaya",
  "delivery-charge",
] as const;
export type CodDetailBucket = (typeof COD_DETAIL_BUCKETS)[number];

export interface CodDetailRow {
  id: string;
  trackingId: string;
  orderNumber: number;
  vendorName: string;
  receiverName: string;
  riderName: string | null;
  collectedAmount: number;
  riderRemittedAmount: number;
  remittedAmount: number;
  deliveryCharge: number;
  /** The amount this bucket is actually about for this row, so the rows always
   *  sum to the dashboard figure that linked here: gross collection for
   *  'total', the settled leg for 'settled', the office's cut for
   *  'delivery-charge', and outstanding cash for the rest. */
  bucketAmount: number;
  deliveredAt: string | null;
}

// Same cap-and-flag shape as VendorMetricDetail's bulk-fetch pattern on the
// client - COD buckets are bounded per-vendor/per-office data, not a
// high-volume list, so one capped query is simpler than cursor pagination
// and matches how the rest of this app already handles dashboard drill-downs.
const COD_DETAIL_ROW_CAP = 1000;

export async function getCodSettlementDetail(
  actor: OrderActor,
  bucket: CodDetailBucket,
): Promise<{ rows: CodDetailRow[]; capped: boolean }> {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);

  const codScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND c.vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND c.vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? Prisma.sql`AND c.rider_id = ${riderId}::uuid`
    : Prisma.empty;

  // Same durable NCM/Upaya signals as the dashboard summary above - see its comment.
  const ncmHandoffExistsSql = Prisma.sql`EXISTS (
    SELECT 1 FROM parcel_remarks pr
    WHERE pr.parcel_id = p.id AND pr.remark LIKE ${NCM_HANDOFF_REMARK_PREFIX + "%"}
  )`;
  const upayaHandoffExistsSql = Prisma.sql`EXISTS (
    SELECT 1 FROM parcel_remarks pr
    WHERE pr.parcel_id = p.id AND pr.remark LIKE ${UPAYA_HANDOFF_REMARK_PREFIX + "%"}
  )`;

  // The "settled" leg is scope-dependent, exactly as in computeDashboardSummary:
  // a rider's own dashboard measures settlement as cash remitted to the office
  // (rider_remitted_amount), everyone else's as cash remitted onward to the
  // vendor (remitted_amount). Reusing one column for both would make a rider's
  // drill-down disagree with the card that linked to it.
  const remittedColSql: Prisma.Sql = riderId
    ? Prisma.sql`c.rider_remitted_amount`
    : Prisma.sql`c.remitted_amount`;
  const settledExprSql = Prisma.sql`LEAST(${remittedColSql}, c.collected_amount)`;
  const pendingExprSql = Prisma.sql`c.collected_amount - ${settledExprSql}`;

  // Mirrors the per-bucket formulas in computeDashboardSummary exactly, so a
  // detail page's rows always sum to the dashboard figure that linked here.
  const bucketFilterSql: Prisma.Sql =
    bucket === "settled"
      ? Prisma.sql`AND ${settledExprSql} > 0`
      : bucket === "pending"
        ? Prisma.sql`AND ${pendingExprSql} > 0`
        : bucket === "pm-rider"
          ? Prisma.sql`AND c.rider_id IS NOT NULL AND r.carrier_code IS NULL AND (c.collected_amount - LEAST(c.rider_remitted_amount, c.collected_amount)) > 0`
          : bucket === "ncm"
            ? Prisma.sql`AND ((c.rider_id IS NULL AND ${ncmHandoffExistsSql}) OR r.carrier_code = 'ncm') AND (c.collected_amount - LEAST(c.remitted_amount, c.collected_amount)) > 0`
            : bucket === "upaya"
              ? Prisma.sql`AND ((c.rider_id IS NULL AND ${upayaHandoffExistsSql}) OR r.carrier_code = 'upaya') AND (c.collected_amount - LEAST(c.remitted_amount, c.collected_amount)) > 0`
              : Prisma.empty; // 'total' and 'delivery-charge': every in-scope row

  // Each bucket's rows must add up to the exact figure on the card, so the
  // per-row amount is the bucket's own measure - the gross collection for
  // "total", the settled leg for "settled", the office's cut for
  // "delivery-charge", and outstanding cash for the rest.
  const outstandingExprSql: Prisma.Sql =
    bucket === "total"
      ? Prisma.sql`c.collected_amount`
      : bucket === "settled"
        ? settledExprSql
        : bucket === "pm-rider"
          ? Prisma.sql`c.collected_amount - LEAST(c.rider_remitted_amount, c.collected_amount)`
          : bucket === "ncm" || bucket === "upaya"
            ? Prisma.sql`c.collected_amount - LEAST(c.remitted_amount, c.collected_amount)`
            : bucket === "delivery-charge"
              ? Prisma.sql`p.delivery_charge`
              : pendingExprSql;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      tracking_id: string;
      order_number: number;
      vendor_name: string | null;
      receiver_name: string;
      rider_name: string | null;
      collected_amount: string;
      rider_remitted_amount: string;
      remitted_amount: string;
      delivery_charge: string;
      bucket_amount: string;
      delivered_at: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      c.id,
      p.tracking_id,
      p.order_number,
      COALESCE(v.business_name, v.client_name) AS vendor_name,
      party.name AS receiver_name,
      r.name AS rider_name,
      c.collected_amount,
      c.rider_remitted_amount,
      c.remitted_amount,
      p.delivery_charge,
      (${outstandingExprSql}) AS bucket_amount,
      p.delivered_at
    FROM cod_collections c
    JOIN parcels p ON p.id = c.parcel_id
    JOIN parties party ON party.id = p.receiver_id
    LEFT JOIN vendors v ON v.id = c.vendor_id
    LEFT JOIN riders r ON r.id = c.rider_id
    WHERE p.deleted_at IS NULL
      AND p.status::text IN ('delivered', 'partially_delivered')
      ${codScopeSql}
      ${bucketFilterSql}
    ORDER BY p.delivered_at DESC NULLS LAST, c.id DESC
    LIMIT ${COD_DETAIL_ROW_CAP + 1}
  `);

  const capped = rows.length > COD_DETAIL_ROW_CAP;
  const trimmed = capped ? rows.slice(0, COD_DETAIL_ROW_CAP) : rows;

  return {
    capped,
    rows: trimmed.map((r) => ({
      id: r.id,
      trackingId: r.tracking_id,
      orderNumber: r.order_number,
      vendorName: r.vendor_name ?? "—",
      receiverName: r.receiver_name,
      riderName: r.rider_name,
      collectedAmount: Number(r.collected_amount),
      riderRemittedAmount: Number(r.rider_remitted_amount),
      remittedAmount: Number(r.remitted_amount),
      deliveryCharge: Number(r.delivery_charge),
      bucketAmount: Number(r.bucket_amount),
      deliveredAt: r.delivered_at ? r.delivered_at.toISOString() : null,
    })),
  };
}

// The vendor IS the default sender for any order they create - this resolves
// their own business identity server-side so the client never has to ask a
// vendor (or their staff) to type in "who is sending this", and can't diverge
// from the vendor_id the order actually gets attributed to.
export async function getSenderProfile(actor: OrderActor) {
  const ownVendorId = await resolveOwnVendorId(actor);
  if (!ownVendorId) {
    throw new AppError(403, "Only vendors or their staff have a default sender profile");
  }

  const vendor = await prisma.vendors.findFirst({
    where: { id: ownVendorId, deleted_at: null, status: "active" },
    select: { id: true, business_name: true, client_name: true, phone: true, address: true, pickup_landmark: true, location_id: true },
  });
  if (!vendor) {
    throw new AppError(403, "Vendor profile not found or inactive");
  }

  // The sender address is driven by the vendor's selected pickup Location, so
  // changing the shop's location updates where new orders ship from. The pickup
  // landmark (a finer detail like "near X chowk") is appended after it, and the
  // free-text address is only a last-resort fallback when no Location is set.
  const location = vendor.location_id
    ? await prisma.locations.findUnique({
        where: { id: vendor.location_id },
        select: { name: true, city: true, district: true },
      })
    : null;
  const locationLabel = locationName(location);
  const address =
    [locationLabel, vendor.pickup_landmark].filter(Boolean).join(", ") || vendor.address || "";

  return {
    id: vendor.id,
    name: vendor.business_name || vendor.client_name,
    phone: vendor.phone,
    address,
    locationId: vendor.location_id,
  };
}

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

/** True when this transition takes the parcel out of a delivered state -
 *  delivered → partially_delivered (and back) re-stamps rather than reverses. */
const isUndelivering = (from: parcel_status, to: string) =>
  DELIVERY_STATUSES.includes(from) && !DELIVERY_STATUSES.includes(to as parcel_status);

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
    const v = parcel.vendors;
    try {
      const quote = await getReturnDeliveryQuote(
        (v?.rate_type as RateType) ?? "flat",
        parcel.destination_location_id,
        parcel.weight_kg === null ? 1 : Number(parcel.weight_kg),
        v
          ? {
              flatInsideValley: v.flat_inside_valley === null ? null : Number(v.flat_inside_valley),
              flatOutsideValley: v.flat_outside_valley === null ? null : Number(v.flat_outside_valley),
              zoneMajorCities: v.zone_major_cities === null ? null : Number(v.zone_major_cities),
              zoneUrbanAreas: v.zone_urban_areas === null ? null : Number(v.zone_urban_areas),
              zoneRemoteAreas: v.zone_remote_areas === null ? null : Number(v.zone_remote_areas),
              zoneInsideValley: v.zone_inside_valley === null ? null : Number(v.zone_inside_valley),
              insideValleyFlatRate: v.inside_valley_flat_rate === null ? null : Number(v.inside_valley_flat_rate),
              extraWeightPercent: v.extra_weight_percent === null ? null : Number(v.extra_weight_percent),
              ...branchOverrides(v),
              returnInsideValleyPercent: v.return_inside_valley_percent === null ? null : Number(v.return_inside_valley_percent),
              returnOutsideValleyPercent: v.return_outside_valley_percent === null ? null : Number(v.return_outside_valley_percent),
            }
          : {},
        parcel.service_type as ServiceType,
      );
      returnCharge = quote.totalPayable;
    } catch {
      // Unclassified destination / missing rate: fall back to a free return
      // rather than blocking the exchange delivery itself.
      returnCharge = 0;
    }
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

  const txOutcome = await prisma.$transaction(async (tx) => {
    let createdReturn: { id: string; trackingId: string } | null = null;
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
        const ret = await tx.parcels.create({
          data: {
            tracking_id: returnTrackingId,
            search_text: buildSearchText(returnTrackingId, customerParty, vendorParty),
            vendor_id: parcel.vendor_id,
            // Goods flow customer → vendor: swap the exchange order's parties/route.
            sender_id: parcel.receiver_id,
            receiver_id: parcel.sender_id,
            origin_location_id: parcel.destination_location_id,
            current_location_id: parcel.destination_location_id,
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
        createdReturn = { id: ret.id, trackingId: ret.tracking_id };
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

    return { updatedParcel, createdReturn };
  });

  const { updatedParcel, createdReturn } = txOutcome;

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

export interface BulkUpdateResult {
  updatedCount: number;
  status: ParcelStatus;
  dispatch?: {
    id: string;
    dispatchNo: string;
    toLocationId: string;
  };
  // Parcels in the request that were already at `status` and were dropped
  // from the batch as a no-op rather than failing the whole request.
  alreadyUpToDate?: number;
}

/**
 * Bulk status transition for OOV/dispatch operations. Validates every parcel
 * up front, then performs all writes as batched queries inside a single
 * transaction instead of N individual round trips - this is what backs
 * the OOV page's multi-select "Action" bar.
 *
 * When the target status is "dispatched", this also opens a dispatch
 * manifest (dispatches + dispatch_parcels) grouping the selected parcels,
 * and closes it out (dispatches.arrived_at) once every parcel in it has
 * reached "arrived_at_branch".
 */
export async function bulkUpdateParcelStatus(
  actor: OrderActor,
  data: BulkUpdateParcelStatusInput,
): Promise<BulkUpdateResult> {
  const ids = Array.from(new Set(data.ids));
  if (ids.length === 0) {
    throw new AppError(400, "No parcel ids provided");
  }
  if (ids.length > MAX_BULK_IDS) {
    throw new AppError(400, `Cannot update more than ${MAX_BULK_IDS} parcels at once`);
  }

  return withParcelStatusLocks(ids, () => _bulkUpdateParcelStatusImpl(actor, ids, data));
}

async function _bulkUpdateParcelStatusImpl(
  actor: OrderActor,
  ids: string[],
  data: BulkUpdateParcelStatusInput,
): Promise<BulkUpdateResult> {
  const newStatus = data.status;
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  // A super_admin may force any status from any status (including out of a
  // terminal state) - the transition map only constrains everyone else.
  const isSuperAdmin = actor.roles.includes("super_admin");
  const isVendorActor =
    actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
  const isRiderActor = actor.roles.includes("rider") && !isAdmin;

  // Hub operations (dispatch, OOV transitions) are admin-only.
  if (HUB_OPERATION_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can perform dispatch hub operations");
  }
  // The return-to-origin workflow is staff-only.
  if (RETURN_WORKFLOW_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can manage the return workflow");
  }
  // Hold / loss & damage are managed from the ops dashboard, not riders/vendors.
  if (OPS_RESTRICTED_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can manage hold / loss & damage status");
  }
  // Assigning a rider to a parcel is an admin/vendor operation done via the ops
  // dashboard's rider picker, never a rider self-service action.
  if (RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status] && isRiderActor) {
    throw new AppError(403, "Assigning a rider to a parcel is an admin/vendor operation");
  }
  // Cancellation is allowed for admins and vendors (vendors may only cancel their own orders,
  // enforced by the vendor_id scope below).
  if (newStatus === "cancelled" && !isAdmin && !isVendorActor) {
    throw new AppError(403, "Only vendors or admins can cancel orders");
  }

  // Resolve vendor/rider/sales scope so non-admins can only act on their own
  // parcels. Sales (not currently routed here) are scoped to their vendors as
  // defence in depth via the vendorIds IN filter below.
  const isSalesActor = actor.roles.includes("sales") && !isAdmin;
  const { vendorId, vendorIds, riderId: actorRiderId } =
    isVendorActor || isRiderActor || isSalesActor
      ? await getActorScope(actor)
      : { vendorId: undefined, vendorIds: undefined, riderId: undefined };

  if (isRiderActor && !actorRiderId) {
    throw new AppError(403, "Rider profile not found or inactive");
  }

  let parcels = await prisma.parcels.findMany({
    where: {
      id: { in: ids },
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    },
    include: { pickup_tasks: true, locations_parcels_destination_location_idTolocations: true, vendors: true },
  });

  if (parcels.length !== ids.length) {
    throw new AppError(404, "One or more parcels were not found or do not belong to your account");
  }

  // Idempotent no-op: a parcel already at the target status isn't a
  // transition at all - STATUS_TRANSITIONS uniformly disallows self-
  // transitions - so it can only mean the parcel got here between the client
  // rendering this batch and this request landing (another actor's request,
  // a reconcile sweep, or the caller's own resubmitted scan). Drop it from
  // the batch instead of 422ing the whole thing on 'X → X', same as if it
  // had never been selected. Terminal statuses are excluded from this skip -
  // those fall through to the terminal-state check below, unchanged, same as
  // the single-parcel path.
  const isNoOp = (p: (typeof parcels)[number]) =>
    p.status === newStatus && !TERMINAL_STATUSES.includes(p.status as parcel_status);
  const alreadyDoneCount = parcels.filter(isNoOp).length;
  parcels = parcels.filter((p) => !isNoOp(p));
  const idsToUpdate = parcels.map((p) => p.id);

  if (parcels.length === 0) {
    return { updatedCount: 0, status: newStatus, alreadyUpToDate: alreadyDoneCount };
  }

  for (const parcel of parcels) {
    const currentStatus = parcel.status as ParcelStatus;
    if (!isSuperAdmin && TERMINAL_STATUSES.includes(currentStatus as parcel_status)) {
      throw new AppError(
        409,
        `Parcel ${parcel.tracking_id} is already '${currentStatus}' (terminal state)`,
      );
    }
    if (!isSuperAdmin) {
      const allowed = STATUS_TRANSITIONS[
        currentStatus as keyof typeof STATUS_TRANSITIONS
      ] as readonly ParcelStatus[];
      if (!allowed || !allowed.includes(newStatus)) {
        throw new AppError(
          422,
          `Invalid status transition for ${parcel.tracking_id}: '${currentStatus}' → '${newStatus}'`,
        );
      }

      // From "arrived", destination decides whether the parcel skips Transit
      // (inside valley + fringe areas) or must go through it (everywhere else).
      if (currentStatus === "arrived" && (newStatus === "ready_to_deliver" || newStatus === "oov")) {
        const skipsTransit = destinationSkipsTransit(parcel.locations_parcels_destination_location_idTolocations);
        if (skipsTransit && newStatus === "oov") {
          throw new AppError(422, `Parcel ${parcel.tracking_id}: destination is inside the valley, must go to 'Ready to Deliver', not 'Transit'.`);
        }
        if (!skipsTransit && newStatus === "ready_to_deliver") {
          throw new AppError(422, `Parcel ${parcel.tracking_id}: destination is outside the valley, must go to 'Transit' first.`);
        }
      }
    }
    // Riders may only progress parcels they're actually assigned to, and only
    // for the leg (pickup vs delivery) they were assigned for.
    if (isRiderActor && actorRiderId) {
      assertRiderOwnsLeg(currentStatus as parcel_status, parcel, actorRiderId);
    }
  }

  // Parcels in this batch leaving a delivery state for something else.
  // newStatus is shared across the whole batch, so this is just a filter over
  // each parcel's current status. Split exactly as in the single-parcel path:
  // leaving the delivery leg releases the rider, but only retracting a
  // COMPLETED delivery reverses the money - a partial's collected cash is real
  // and survives the move to follow_up/ready_to_return.
  const leavingDeliveryIds = parcels
    .filter(
      (p) =>
        DELIVERY_RIDER_HELD_STATUSES.includes(p.status as parcel_status) &&
        !DELIVERY_RIDER_HELD_STATUSES.includes(newStatus as parcel_status),
    )
    .map((p) => p.id);
  const reversalParcels = parcels.filter(
    (p) => p.status === "delivered" && !["delivered", "partially_delivered"].includes(newStatus),
  );
  const undeliverIds = reversalParcels.map((p) => p.id);

  // Same guard as the single-parcel path: don't blow away a COD that's
  // already been swept into a settlement - paid, or still pending (whose
  // settlement_items row already froze this collection's amount).
  if (undeliverIds.length > 0) {
    const blockingCod = await prisma.cod_collections.findFirst({
      where: {
        parcel_id: { in: undeliverIds },
        OR: [{ rider_payment_status: "paid" }, { payment_status: "paid" }, { settlement_items: { some: {} } }],
      },
      include: {
        parcels: { select: { tracking_id: true } },
        settlement_items: { select: { settlements: { select: { statement_id: true, payee_type: true } } }, take: 1 },
      },
    });
    if (blockingCod) {
      const stmt = blockingCod.settlement_items[0]?.settlements;
      const reason = stmt ? `is part of ${stmt.payee_type} settlement ${stmt.statement_id}` : "has already been settled";
      throw new AppError(409, `Order ${blockingCod.parcels.tracking_id}'s COD ${reason} — resolve that before undelivering.`);
    }
  }

  let toLocationId: string | null = null;
  let originLocationId: string | null = null;
  let riderId: string | null = null;
  let riderName: string | null = null;

  if (newStatus === "dispatched") {
    // A manifest only exists when there's a destination to carry it to, so a
    // rider named without one would be validated and then silently dropped
    // along with the whole dispatch record. The ops UI already blocks this;
    // this stops the API doing it quietly.
    if (data.riderId && !data.toLocationId) {
      throw new AppError(422, "A destination hub is required to dispatch a manifest to a rider");
    }
    if (data.toLocationId) {
      const distinctOrigins = new Set(parcels.map((p) => p.current_location_id || ""));
      if (distinctOrigins.size !== 1 || distinctOrigins.has("")) {
        throw new AppError(
          422,
          "All selected parcels must share the same current location to be dispatched together",
        );
      }
      originLocationId = parcels[0]!.current_location_id;

      if (originLocationId === data.toLocationId) {
        throw new AppError(422, "Destination hub must differ from the current location");
      }

      const destination = await prisma.locations.findUnique({ where: { id: data.toLocationId } });
      if (!destination || !destination.is_active) {
        throw new AppError(400, "Destination location not found or inactive");
      }
      toLocationId = destination.id;

      if (data.riderId) {
        const rider = await prisma.riders.findFirst({
          where: { id: data.riderId, deleted_at: null, status: "active" },
        });
        if (!rider) {
          throw new AppError(400, "Rider not found or inactive");
        }
        riderId = rider.id;
        riderName = rider.name;
      }
    }
  }

  if (data.toLocationId && newStatus !== "dispatched") {
    const loc = await prisma.locations.findUnique({ where: { id: data.toLocationId } });
    if (!loc || !loc.is_active) {
      throw new AppError(400, "Location not found or inactive");
    }
  }

  // rider_assigned needs a pickup rider, sent_for_delivery needs a delivery rider
  // (rider actors are already rejected above, before reaching this point)
  const riderAssignmentField = RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status];
  let parcelRiderId: string | null = null;
  if (riderAssignmentField) {
    if (!data.riderId) {
      throw new AppError(400, `riderId is required to transition to '${newStatus}'`);
    }
    const rider = await resolveActiveRider(data.riderId);
    parcelRiderId = rider.id;
  }

  // Validate partially_delivered requirements
  if (newStatus === "partially_delivered") {
    if (!data.remarks || data.remarks.trim().length === 0) {
      throw new AppError(400, "Remarks are required when status is partially_delivered");
    }
    if (data.codCollected === undefined || data.codCollected < 0) {
      throw new AppError(400, "COD collected is required and must be non-negative when status is partially_delivered");
    }
    // Validate codCollected doesn't exceed any parcel's total COD
    for (const parcel of parcels) {
      const totalCod = Number(parcel.cod_amount);
      if (data.codCollected > totalCod) {
        throw new AppError(400, `COD collected (${data.codCollected}) cannot exceed parcel ${parcel.tracking_id}'s total COD (${totalCod})`);
      }
    }
  }

  // Cancelling or failing an order requires a reason.
  if (REASON_REQUIRED_STATUSES.includes(newStatus as parcel_status)) {
    if (!data.remarks || data.remarks.trim().length === 0) {
      throw new AppError(400, "Remarks are required to cancel or fail an order");
    }
  }

  // Same re-pricing as the single-parcel path: a plain RTO bills the
  // discounted return-percent charge, not the full outbound delivery_charge.
  // Per-parcel (destination/weight/vendor can all differ within one batch),
  // so this can't be a single query - run in parallel since these are
  // independent reads done before the transaction starts.
  const rtoReturnCharges = new Map<string, number>();
  if (newStatus === "returned_to_vendor") {
    await Promise.all(
      parcels
        .filter((p) => p.order_type !== "return" && p.destination_location_id)
        .map(async (p) => {
          const charge = await computeReturnCharge(
            p.vendors,
            p.destination_location_id!,
            p.weight_kg === null ? null : Number(p.weight_kg),
            p.service_type,
          );
          if (charge !== null) rtoReturnCharges.set(p.id, charge);
        }),
    );
  }

  // The return manifest driving this transition, if any. Read before the
  // transaction purely for its number, which goes onto every member parcel's
  // timeline - the manifest row itself is updated inside, next to the dispatch.
  const returnManifest = data.returnManifestId
    ? await prisma.return_manifests.findUnique({
        where: { id: data.returnManifestId },
        select: { id: true, manifest_no: true },
      })
    : null;

  const result = await prisma.$transaction(async (tx) => {
    let dispatch: { id: string; dispatch_no: string } | null = null;

    if (newStatus === "dispatched" && toLocationId && originLocationId) {
      const dispatchNo = await generateUniqueDispatchNo(tx);
      dispatch = await tx.dispatches.create({
        data: {
          dispatch_no: dispatchNo,
          from_location_id: originLocationId,
          to_location_id: toLocationId,
          delivery_rider_id: riderId,
          dispatched_by: actor.id,
        },
      });
      await tx.dispatch_parcels.createMany({
        data: parcels.map((p) => ({ dispatch_id: dispatch!.id, parcel_id: p.id })),
      });
    }

    // The manifest number and its driver are otherwise write-only: nothing in
    // the app has ever read dispatches.delivery_rider_id back, so ops picked a
    // "Rider / vehicle" and the choice vanished. Folding it into the status
    // history puts it on the order timeline, where ops already looks when a
    // parcel goes missing in transit - and it needs no new endpoint or screen.
    //
    // Deliberately the timeline and not the rider app: a transfer driver is
    // not the last-mile rider, holds no COD, and must not appear in anyone's
    // custody list. This records who drove it, nothing more.
    const dispatchRemark = dispatch
      ? `Manifest ${dispatch.dispatch_no}${riderName ? ` · carried by ${riderName}` : ""}`
      : null;

    // Same reasoning for the return leg: the manifest number is the only handle
    // anyone has on "which hand-over did this parcel go back on", so it belongs
    // on the timeline rather than only in the manifests list. Composed the same
    // way and folded into the same remarks field below.
    const batchRemark = returnManifest
      ? `Manifest ${returnManifest.manifest_no}${riderName ? ` · carried by ${riderName}` : ""}`
      : dispatchRemark;

    const updateData: Prisma.parcelsUpdateInput = { status: newStatus as parcel_status };
    if (newStatus === "picked_up") {
      (updateData as any).picked_up_at = new Date();
    }
    if (newStatus === "delivered") {
      (updateData as any).delivered_at = new Date();
    }
    if (newStatus === "partially_delivered") {
      (updateData as any).delivered_at = new Date();
      (updateData as any).partial_delivery_remarks = data.remarks || null;
      (updateData as any).partial_cod_collected = data.codCollected ?? 0;
    }
    if (toLocationId) {
      (updateData as any).current_location_id = toLocationId;
    } else if (data.toLocationId) {
      (updateData as any).current_location_id = data.toLocationId;
    }
    if (riderAssignmentField && parcelRiderId) {
      (updateData as any)[riderAssignmentField] = parcelRiderId;
    }
    // Side-effect: every parcel in the batch is going back into the unassigned
    // pickup pool, so none of them keeps its old rider (see
    // releasesPickupRider). Unlike the delivery release below this needs no
    // per-parcel subset and no anti-clobber guard: the destination status is
    // the same for the whole batch, and pickup_ordered is not in
    // RIDER_ASSIGNMENT_FIELD, so nothing here is assigning a pickup rider.
    if (releasesPickupRider(newStatus as parcel_status)) {
      (updateData as any).pickup_rider_id = null;
    }
    // Each hand-off to a delivery rider counts as one delivery attempt.
    if (newStatus === "sent_for_delivery") {
      (updateData as any).attempt_count = { increment: 1 };
    }

    // A batch hand-off to a delivery rider opens one run sheet for the batch.
    if (newStatus === "sent_for_delivery" && parcelRiderId) {
      await createRunSheet(tx, parcelRiderId, idsToUpdate, actor.id);
    }

    await tx.parcels.updateMany({
      where: { id: { in: idsToUpdate } },
      data: updateData,
    });

    // Skip path, batch flavour: updateData above only stamps picked_up_at on
    // the real pickup transition, but a super_admin can force a batch straight
    // past it. Scoped to picked_up_at: null so it can never overwrite a genuine
    // pickup time - which also makes it a no-op on the normal flow. Separate
    // from the updateMany above because that single blob applies to the whole
    // batch, while this must skip the parcels that already carry a timestamp.
    //
    // idsToUpdate, not ids: the no-op filter above drops parcels already at
    // newStatus from the batch, and those are precisely the ones nothing is
    // happening to - stamping them would invent a pickup time for a parcel
    // this request never touched.
    if (newStatus !== "picked_up" && POST_PICKUP_STATUSES.includes(newStatus as parcel_status)) {
      await tx.parcels.updateMany({
        where: { id: { in: idsToUpdate }, picked_up_at: null },
        data: { picked_up_at: new Date() },
      });
    }

    // Side-effect: release the delivery rider on every parcel coming off the
    // delivery leg, plus every parcel whose delivery is being retracted - the
    // reversal nulls cod_collections.rider_id, so the parcel must not keep
    // pointing at a rider the money no longer does (delivered →
    // returned_to_vendor is not "leaving", since both are held). Mirrors the
    // single-parcel path. Scoped, not applied to `ids`, since not every parcel
    // in a mixed batch is necessarily leaving the delivery leg.
    //
    // Skipped when this same transition is assigning a delivery rider (a
    // super_admin forcing delivered → sent_for_delivery/sent_to_vendor):
    // unlike the single-parcel path, this runs AFTER updateData is applied, so
    // releasing here would clobber the assignment instead of losing to it.
    // Now that sent_to_vendor is itself held, only the undeliverIds half can
    // still collide - leavingDeliveryIds is empty whenever the new status
    // assigns a delivery rider - but the guard covers both and stays as is.
    const releaseRiderIds = Array.from(new Set([...leavingDeliveryIds, ...undeliverIds]));
    if (releaseRiderIds.length > 0 && !(riderAssignmentField === "delivery_rider_id" && parcelRiderId)) {
      await tx.parcels.updateMany({
        where: { id: { in: releaseRiderIds } },
        data: { delivery_rider_id: null },
      });
    }

    // Side-effect: retract the delivery itself, for the subset whose delivery
    // was completed (not partial) - the money reversal, mirroring the
    // single-parcel path.
    if (undeliverIds.length > 0) {
      await tx.parcels.updateMany({
        where: { id: { in: undeliverIds } },
        data: {
          delivered_at: null,
          partial_delivery_remarks: null,
          partial_cod_collected: null,
        },
      });
      await tx.cod_collections.updateMany({
        where: { parcel_id: { in: undeliverIds } },
        data: { collected_amount: 0, collected_at: null, rider_id: null },
      });
    }

    // Tag the COD record with whichever rider is now responsible for
    // collecting it, so rider-scoped COD/finance queries can find it -
    // nothing else in the app ever sets cod_collections.rider_id otherwise.
    if (riderAssignmentField === "delivery_rider_id" && parcelRiderId) {
      await tx.cod_collections.updateMany({
        where: { parcel_id: { in: idsToUpdate } },
        data: { rider_id: parcelRiderId },
      });
    }

    // Side-effect: record what was actually collected on delivery, so the COD
    // settlement ledger (cod_collections) reflects real cash in hand instead
    // of staying at its order-creation defaults forever. Not gated on a
    // delivery rider being on record - see the single-parcel path above.
    // Amounts can differ per parcel (full cod_amount vs the shared partial
    // codCollected), so this can't be a single updateMany.
    if (newStatus === "delivered" || newStatus === "partially_delivered") {
      const collectedAt = new Date();
      // Sequential, not Promise.all: tx is bound to a single Postgres
      // connection, so "concurrent" queries against it just pipeline on that
      // one client rather than running in parallel - pg itself now warns on
      // this ("client.query() called while already executing a query",
      // removed in pg@9). Awaiting one at a time is the same wall-clock cost
      // and avoids relying on deprecated client-side query queueing.
      for (const p of parcels) {
        const collectedAmount = newStatus === "delivered" ? Number(p.cod_amount) : (data.codCollected ?? 0);
        // No collectedAmount <= 0 skip here: a COD corrected down to 0 (or a
        // genuine zero-cash partial delivery) must still overwrite whatever
        // stale amount is sitting on the row - see the single-parcel path above.
        await tx.cod_collections.upsert({
          where: { parcel_id: p.id },
          create: {
            parcel_id: p.id,
            vendor_id: p.vendor_id,
            rider_id: p.delivery_rider_id,
            cod_amount: p.cod_amount,
            collected_amount: collectedAmount,
            collected_at: collectedAt,
          },
          update: {
            rider_id: p.delivery_rider_id,
            cod_amount: p.cod_amount,
            collected_amount: collectedAmount,
            collected_at: collectedAt,
          },
        });
      }
    }

    // Same rule as the single-parcel path: any parcel reaching the vendor -
    // genuine return leg or plain RTO alike - gets collected_at stamped so it
    // enters the settlement ledger and earns its delivery_charge (see
    // billing.service.ts's EARNED_CHARGE_SQL).
    if (newStatus === "returned_to_vendor") {
      await tx.cod_collections.updateMany({
        where: { parcel_id: { in: parcels.map((p) => p.id) } },
        data: { collected_at: new Date() },
      });
      // Re-price each plain RTO to its discounted return-percent charge
      // (computed above, before the transaction). Per-parcel amounts, so
      // this can't be a single updateMany - same reasoning as the
      // collected_amount loop above.
      for (const [parcelId, charge] of rtoReturnCharges) {
        await tx.parcels.update({ where: { id: parcelId }, data: { delivery_charge: charge } });
      }
    }

    const pickupSyncIds = parcels
      .filter((p) => p.pickup_tasks && ["pickup_ordered", "rider_assigned", "picked_up", "cancelled"].includes(newStatus))
      .map((p) => p.id);
    if (pickupSyncIds.length) {
      await tx.pickup_tasks.updateMany({
        where: { parcel_id: { in: pickupSyncIds } },
        data: { status: newStatus as parcel_status },
      });
    }

    await tx.parcel_status_history.createMany({
      data: parcels.map((p) => ({
        parcel_id: p.id,
        old_status: p.status,
        new_status: newStatus as parcel_status,
        location_id: toLocationId || data.toLocationId || p.current_location_id,
        changed_by: actor.id,
        remarks: batchRemark
          ? [batchRemark, data.remarks?.trim()].filter(Boolean).join(" — ")
          : data.remarks || null,
      })),
    });
    // See the single-update path for why this also needs to land in
    // parcel_remarks, not just parcel_status_history.
    if (data.remarks && data.remarks.trim().length > 0) {
      await tx.parcel_remarks.createMany({
        data: parcels.map((p) => ({
          parcel_id: p.id,
          user_id: actor.id,
          location_id: toLocationId || data.toLocationId || p.current_location_id,
          remark: `Marked ${(newStatus as string).replace(/_/g, " ")}: ${data.remarks!.trim()}`,
        })),
      });
    }

    await tx.audit_logs.createMany({
      data: parcels.map((p) => ({
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: p.id,
        action: "BULK_UPDATE_STATUS",
        old_data: { status: p.status },
        new_data: { status: newStatus, dispatchId: dispatch?.id || null },
      })),
    });

    // One webhook event per parcel — each has its own tracking ID even though
    // newStatus is shared across the whole batch. Batched into a single
    // endpoint lookup + single createMany instead of one round trip per
    // parcel (see emitWebhookEventsBatch).
    const changedAt = new Date().toISOString();
    await emitWebhookEventsBatch(
      tx,
      "order.status_changed",
      parcels
        .filter((p) => p.vendor_id)
        .map((p) => ({
          vendorId: p.vendor_id!,
          data: {
            trackingId: p.tracking_id,
            orderId: p.id,
            vendorId: p.vendor_id,
            oldStatus: p.status,
            newStatus,
            changedAt,
          },
        })),
    );

    // Close out manifests once none of their parcels are still "dispatched" -
    // one groupBy instead of a per-dispatch count()+updateMany() loop, since
    // the loop was issuing N sequential round trips while holding transaction locks.
    if (newStatus === "arrived_at_branch") {
      const links = await tx.dispatch_parcels.findMany({
        where: { parcel_id: { in: idsToUpdate } },
        select: { dispatch_id: true },
        distinct: ["dispatch_id"],
      });

      if (links.length) {
        const dispatchIds = links.map((link) => link.dispatch_id);
        const stillInTransit = await tx.dispatch_parcels.groupBy({
          by: ["dispatch_id"],
          where: { dispatch_id: { in: dispatchIds }, parcels: { status: "dispatched" } },
        });
        const inTransitIds = new Set(stillInTransit.map((row) => row.dispatch_id));
        const completedDispatchIds = dispatchIds.filter((id) => !inTransitIds.has(id));

        if (completedDispatchIds.length) {
          await tx.dispatches.updateMany({
            where: { id: { in: completedDispatchIds }, arrived_at: null },
            data: { arrived_at: new Date() },
          });
        }
      }
    }

    // The return manifest moves with its parcels, in this same transaction -
    // the same rule the dispatch manifest and the run sheet already follow.
    // Doing it as a second call after bulkUpdateParcelStatus returned would
    // leave a window where the parcels are sent_to_vendor but the manifest
    // still reads 'open', and the retry would then fail the transition check
    // with no way back short of SQL.
    if (returnManifest && newStatus === "sent_to_vendor") {
      await tx.return_manifests.update({
        where: { id: returnManifest.id },
        data: {
          status: "sent",
          rider_id: parcelRiderId,
          sent_at: new Date(),
          sent_by: actor.id,
        },
      });
    }
    if (returnManifest && newStatus === "returned_to_vendor") {
      await tx.return_manifests.update({
        where: { id: returnManifest.id },
        data: { status: "received", received_at: new Date(), received_by: actor.id },
      });
    }

    // A parcel leaving ready_to_return by any route other than its own
    // manifest's send is no longer part of that hand-over, so drop it.
    //
    // This is not tidiness. bulkUpdateParcelStatus rejects the *whole* batch if
    // any member has an invalid transition, so a single parcel force-reverted
    // out of ready_to_return (super_admin, order detail, QuickActions) would
    // otherwise sit in the manifest as a ghost member and deadlock every later
    // attempt to send it - and there is no remove action reachable once a
    // manifest has left 'open'. Mirrored in _updateParcelStatusImpl.
    if (newStatus !== "sent_to_vendor") {
      const leavingReturnPool = parcels
        .filter((p) => p.status === "ready_to_return")
        .map((p) => p.id);
      if (leavingReturnPool.length) {
        await tx.return_manifest_parcels.deleteMany({
          where: {
            parcel_id: { in: leavingReturnPool },
            return_manifests: { status: "open" },
          },
        });
      }
    }

    return {
      updatedCount: parcels.length,
      status: newStatus,
      ...(dispatch && toLocationId
        ? { dispatch: { id: dispatch.id, dispatchNo: dispatch.dispatch_no, toLocationId } }
        : {}),
      ...(alreadyDoneCount > 0 ? { alreadyUpToDate: alreadyDoneCount } : {}),
    };
  });

  await invalidateOrderCaches();

  // Same finance-cache invalidation as the single-update path (see its note):
  // a reversal rewrites cod_collections, which invalidateOrderCaches does not
  // cover. Deduped so a large batch costs one clear per affected vendor/rider.
  if (reversalParcels.length > 0) {
    const vendorIds = new Set(reversalParcels.map((p) => p.vendor_id).filter((id): id is string => !!id));
    const riderIds = new Set(
      reversalParcels.map((p) => p.delivery_rider_id).filter((id): id is string => !!id),
    );
    for (const id of vendorIds) {
      invalidateVendorFinanceCache(id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
    }
    for (const id of riderIds) {
      invalidateRiderFinanceCache(id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
    }
  }

  // Same balance re-check as the single-update path, deduped by vendor so a
  // 100-parcel batch costs one evaluation per affected vendor, not per parcel.
  if (statusAffectsBalance(newStatus)) {
    evaluateVendorsBillingAsync(parcels.map((p) => p.vendor_id));
  } else {
    evaluateVendorsBillingAsync(
      parcels.filter((p) => statusAffectsBalance(p.status)).map((p) => p.vendor_id),
    );
  }

  // No ledger postings here, and none anywhere else on this path: a parcel is
  // not a money event in the books. Delivering two hundred of them writes no
  // journal entries at all - the statement that settles them does, once. What
  // the vendor is owed in the meantime comes from cod_collections and
  // parcels.delivery_charge, via billing.service, exactly as the balance
  // re-check above uses.

  // Bulk status changes no longer notify vendors or admins (see the single
  // update path) - a batch would otherwise fire a ping per parcel. Failed/
  // cancelled is the one exception (mirrors the single-update path): one
  // notification per affected vendor, not per parcel, so a large batch still
  // can't flood the feed.
  if (REASON_REQUIRED_STATUSES.includes(newStatus as parcel_status)) {
    const vendorIds = [...new Set(parcels.map((p) => p.vendor_id).filter((id): id is string => !!id))];
    if (vendorIds.length > 0) {
      const vendorUsers = await prisma.vendors.findMany({
        where: { id: { in: vendorIds }, user_id: { not: null } },
        select: { id: true, user_id: true },
      });
      const label = (newStatus as string).replace(/_/g, " ");
      for (const vendor of vendorUsers) {
        if (!vendor.user_id || vendor.user_id === actor.id) continue;
        const vendorParcels = parcels.filter((p) => p.vendor_id === vendor.id);
        const single = vendorParcels.length === 1 ? vendorParcels[0] : null;
        createNotification(
          vendor.user_id,
          single ? `Order ${single.tracking_id} marked ${label}` : `${vendorParcels.length} orders marked ${label}`,
          data.remarks || null,
          single?.tracking_id ?? null,
          "status_change",
          single ? `/orders/track/${single.tracking_id}` : "/orders",
        ).catch(() => {});
      }
    }
  }

  return result;
}

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
      // require collected_amount > 0).
      //
      // rider_id is whichever rider legitimately still owns this leg, which is
      // null for a real employee (released above, so their COD settlement is
      // not credited with cash they never carried) and the carrier placeholder
      // where one is routing the parcel - that is what cod_from_ncm /
      // cod_from_upaya read to attribute the cash to the carrier.
      if (targetStatus === "delivered" && Number(parcel.cod_amount) > 0) {
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

// Returns per-status-group counts for the operation-page tab badges. Accepts a
// record like { pickup_ordered: ["pickup_ordered"], rider_assigned:
// ["rider_assigned"], … } and returns { pickup_ordered: 12, rider_assigned: 5 }.
export async function getStatusCounts(
  actor: OrderActor,
  statusGroups: Record<string, string[]>,
  filters: { deliveryRiderId?: string; vendorId?: string[]; search?: string } = {},
): Promise<Record<string, number>> {
  const scope = await getActorScope(actor);
  const allStatuses = [...new Set(Object.values(statusGroups).flat())];

  const scopeSql: Prisma.Sql = scope.vendorId
    ? Prisma.sql`AND vendor_id = ${scope.vendorId}::uuid`
    : scope.vendorIds
      ? Prisma.sql`AND vendor_id = ANY(${scope.vendorIds}::uuid[])`
      : scope.riderId
        ? riderCustodySql(scope.riderId)
        : Prisma.empty;

  // Caller-supplied filters, applied on top of the actor's own scope so the tab
  // badges stay in step with the filtered list (see buildOrdersWhere).
  const riderSql: Prisma.Sql = filters.deliveryRiderId
    ? Prisma.sql`AND delivery_rider_id = ${filters.deliveryRiderId}::uuid`
    : Prisma.empty;

  // ANDed with scopeSql above rather than replacing it: a vendor-scoped actor
  // filtering by vendor still only ever counts their own parcels.
  const vendorSql: Prisma.Sql = filters.vendorId?.length
    ? Prisma.sql`AND vendor_id = ANY(${filters.vendorId}::uuid[])`
    : Prisma.empty;

  // Mirrors buildOrdersWhere's search exactly, or a scan would show one row in
  // the table while the tab above it still claimed the unfiltered total. A
  // comma-separated list (a barcode scanner batching parcels) matches tracking
  // ids outright; a single term goes through the same search_text trigram
  // column the list query uses, plus the order_number equality match that
  // makes "#2980" resolve to one order.
  const searchSql: Prisma.Sql = (() => {
    const search = filters.search?.trim();
    if (!search) return Prisma.empty;

    const terms = search.split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length > 1) {
      const trackingSql = Prisma.sql`lower(tracking_id) = ANY(${terms.map((t) => t.toLowerCase())})`;
      const orderNumbers = terms
        .filter((t) => t.startsWith("#"))
        .map(parseOrderNumber)
        .filter((n): n is number => n !== null);
      return orderNumbers.length
        ? Prisma.sql`AND (${trackingSql} OR order_number = ANY(${orderNumbers}::int[]))`
        : Prisma.sql`AND ${trackingSql}`;
    }

    const orderNumber = parseOrderNumber(search);
    if (orderNumber !== null && search.startsWith("#")) {
      return Prisma.sql`AND order_number = ${orderNumber}::int`;
    }
    const textSql = Prisma.sql`search_text ILIKE ${`%${search.toLowerCase()}%`}`;
    return orderNumber !== null
      ? Prisma.sql`AND (${textSql} OR order_number = ${orderNumber}::int)`
      : Prisma.sql`AND ${textSql}`;
  })();

  const rows = await prisma.$queryRaw<{ status: string; cnt: bigint }[]>(Prisma.sql`
    SELECT status::text AS status, COUNT(*) AS cnt
    FROM parcels
    WHERE deleted_at IS NULL
      AND status::text = ANY(${allStatuses})
      ${scopeSql}
      ${riderSql}
      ${vendorSql}
      ${searchSql}
    GROUP BY status
  `);

  const statusMap = new Map(rows.map((r) => [r.status, Number(r.cnt)]));
  const result: Record<string, number> = {};
  for (const [group, statuses] of Object.entries(statusGroups)) {
    result[group] = statuses.reduce((sum, s) => sum + (statusMap.get(s) ?? 0), 0);
  }
  return result;
}

// ── Trash (soft-deleted orders) ──────────────────────────────────────────────
// `deleted_at` has always been on parcels and filtered out of every read path;
// these are the first writers of it. Nothing here is reachable by a vendor,
// sales or rider actor - the routes are admin-only - so none of it re-checks
// actor scope beyond what listOrders already applies.

/** Cancelled orders older than this are swept into the trash automatically. */
export const CANCELLED_TRASH_AFTER_DAYS = 7;

async function loadParcelForTrash(parcelId: string, opts: { trashed: boolean }) {
  const parcel = await prisma.parcels.findFirst({
    where: { id: parcelId, deleted_at: opts.trashed ? { not: null } : null },
    select: {
      id: true, order_number: true, tracking_id: true, status: true, deleted_at: true,
      vendor_id: true, delivery_rider_id: true,
    },
  });
  if (!parcel) {
    throw new AppError(
      404,
      opts.trashed ? "Order not found in trash" : "Order not found",
    );
  }
  return parcel;
}

/**
 * Soft-deletes one order: it leaves every list and lands in the trash.
 *
 * Cancelled only. An order still moving through the pipeline has riders, hubs
 * and a vendor expecting it, and hiding it from every list mid-flight would
 * strand all three - so the workflow has to be finished (or abandoned via
 * cancel) before it can be filed away. That matches the automatic sweep, which
 * also only ever picks up cancelled orders.
 */
export async function moveOrderToTrash(actor: OrderActor, parcelId: string) {
  const parcel = await loadParcelForTrash(parcelId, { trashed: false });

  if (parcel.status !== "cancelled") {
    throw new AppError(
      409,
      "Only cancelled orders can be moved to the trash. Cancel this order first.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.parcels.update({
      where: { id: parcel.id },
      data: { deleted_at: new Date() },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "TRASH_ORDER",
        old_data: { deletedAt: null, status: parcel.status },
        new_data: { deletedAt: new Date().toISOString(), trackingId: parcel.tracking_id },
      },
    });
    // Nothing to unpost. Since the settlement-only ledger no parcel has its own
    // journal entry, and what the vendor is owed before their statement is read
    // from cod_collections and parcels.delivery_charge - both of which already
    // skip deleted_at rows (see billing.service). Trashing takes the parcel out
    // of the balance by the same query that takes it out of the list.
  });

  await invalidateOrderCaches();
  await invalidateTrashFinanceCaches(parcel);
  return { id: parcel.id, trackingId: parcel.tracking_id };
}

// Trashing and restoring both change what a vendor owes and what a rider is
// holding, so the finance views have to be re-read rather than served from the
// cache the previous state populated.
async function invalidateTrashFinanceCaches(parcel: { vendor_id: string | null; delivery_rider_id: string | null }) {
  const jobs: Promise<unknown>[] = [];
  if (parcel.vendor_id) jobs.push(invalidateVendorFinanceCache(parcel.vendor_id));
  if (parcel.delivery_rider_id) jobs.push(invalidateRiderFinanceCache(parcel.delivery_rider_id));
  await Promise.all(jobs).catch((err) => console.error("[Redis] cache invalidation failed:", err));
}

/**
 * The stages a trashed order may be restored into.
 *
 * This is the one sanctioned way past STATUS_TRANSITIONS. A trashed order is
 * usually cancelled, and `cancelled` is terminal - deliberately, so nothing in
 * the normal workflow can un-cancel an order. Restoring from the trash is the
 * exception: it is admin-only, one order at a time, and audited, so an operator
 * putting a wrongly-cancelled parcel back into the pipeline doesn't need the
 * rule relaxed for every screen in the app. It stays enforced everywhere else.
 */
export const TRASH_RESTORE_STAGES = ["pickup_ordered", "ready_to_deliver"] as const;
export type TrashRestoreStage = (typeof TRASH_RESTORE_STAGES)[number];

/**
 * Puts a trashed order back into the live lists, at `restoreTo`.
 *
 * Writes the status change itself rather than delegating to updateParcelStatus:
 * that function enforces STATUS_TRANSITIONS, which is exactly what this has to
 * step around, and adding a bypass flag to it would put the escape hatch on
 * every caller in the app instead of this one. The side effects that matter for
 * a parcel re-entering at pickup or delivery are reproduced here - history row,
 * audit row, vendor webhook, ledger sync, cache invalidation.
 */
export async function restoreOrderFromTrash(
  actor: OrderActor,
  parcelId: string,
  restoreTo: TrashRestoreStage,
) {
  if (!TRASH_RESTORE_STAGES.includes(restoreTo)) {
    throw new AppError(400, `restoreTo must be one of: ${TRASH_RESTORE_STAGES.join(", ")}`);
  }
  const parcel = await loadParcelForTrash(parcelId, { trashed: true });

  await prisma.$transaction(async (tx) => {
    await tx.parcels.update({
      where: { id: parcel.id },
      data: { deleted_at: null, status: restoreTo },
    });
    // The timeline has to show where the parcel went and that it was a restore,
    // not a silent jump from "cancelled" to "pickup ordered".
    await tx.parcel_status_history.create({
      data: {
        parcel_id: parcel.id,
        old_status: parcel.status,
        new_status: restoreTo,
        changed_by: actor.id,
        remarks: `Restored from trash — ${parcel.status} → ${restoreTo}`.slice(0, 500),
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "RESTORE_ORDER",
        old_data: { deletedAt: parcel.deleted_at?.toISOString() ?? null, status: parcel.status },
        new_data: { deletedAt: null, status: restoreTo, trackingId: parcel.tracking_id },
      },
    });
    // Vendors track parcels through this event; a restore that skipped it would
    // leave their systems believing the order was still cancelled.
    if (parcel.vendor_id) {
      await emitWebhookEvent(tx, parcel.vendor_id, "order.status_changed", {
        trackingId: parcel.tracking_id,
        orderId: parcel.id,
        vendorId: parcel.vendor_id,
        oldStatus: parcel.status,
        newStatus: restoreTo,
        changedAt: new Date().toISOString(),
      });
    }
    // The mirror of the trash case, and equally nothing to do: clearing
    // deleted_at is what puts the parcel back into the vendor balance, because
    // that is the column the billing queries filter on.
  });

  await invalidateOrderCaches();
  await invalidateTrashFinanceCaches(parcel);
  return { id: parcel.id, trackingId: parcel.tracking_id };
}

/**
 * Reports why an order can't be hard-deleted, or null when it's safe to.
 * A parcel with accounting postings can't be deleted at all - journal_lines
 * references it ON DELETE NO ACTION, so Postgres rejects the delete outright -
 * and one with COD records would have them silently cascaded away, taking
 * money movement with it. Both are refused rather than surfaced as a database
 * error or an accidental write-off.
 */
export async function getPermanentDeleteBlocker(parcelId: string): Promise<string | null> {
  const [journalLines, codCollections] = await Promise.all([
    prisma.journal_lines.count({ where: { parcel_id: parcelId } }),
    prisma.cod_collections.count({ where: { parcel_id: parcelId } }),
  ]);
  if (journalLines > 0) {
    return "This order has accounting entries and cannot be deleted. It can stay in the trash instead.";
  }
  if (codCollections > 0) {
    return "This order has COD records and cannot be deleted. It can stay in the trash instead.";
  }
  return null;
}

/**
 * Permanently removes a trashed order. Only ever called for parcels that carry
 * no financial history (see getPermanentDeleteBlocker); the remaining children
 * - remarks, status history, dispatch/run-sheet/manifest links, exceptions,
 * redirects, pickup tasks - are all ON DELETE CASCADE and go with it.
 */
export async function deleteOrderPermanently(actor: OrderActor, parcelId: string) {
  const parcel = await loadParcelForTrash(parcelId, { trashed: true });

  const blocker = await getPermanentDeleteBlocker(parcel.id);
  if (blocker) throw new AppError(409, blocker);

  await prisma.$transaction(async (tx) => {
    // Written before the delete: audit_logs.entity_id has no FK to parcels, but
    // the row it describes must not outlive the record of its removal.
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "DELETE_ORDER_PERMANENTLY",
        old_data: {
          orderNumber: parcel.order_number,
          trackingId: parcel.tracking_id,
          status: parcel.status,
          deletedAt: parcel.deleted_at?.toISOString() ?? null,
        },
        new_data: Prisma.JsonNull,
      },
    });
    await tx.parcels.delete({ where: { id: parcel.id } });
  });

  await invalidateOrderCaches();
  return { id: parcel.id, trackingId: parcel.tracking_id };
}

/**
 * Moves cancelled orders into the trash once they've sat cancelled for
 * CANCELLED_TRASH_AFTER_DAYS. "Cancelled at" is the newest parcel_status_history
 * row that landed on `cancelled`, falling back to updated_at for a parcel with
 * no history - the same shape buildOrdersWhere uses for lastUpdatedAt.
 * Idempotent: already-trashed parcels are excluded by `deleted_at: null`.
 */
export async function sweepCancelledOrdersToTrash(): Promise<{ checked: number; trashed: number }> {
  const cutoff = new Date(Date.now() - CANCELLED_TRASH_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.parcels.findMany({
    where: {
      status: "cancelled",
      deleted_at: null,
      OR: [
        {
          parcel_status_history: {
            some: { new_status: "cancelled", created_at: { lt: cutoff } },
            none: { created_at: { gte: cutoff } },
          },
        },
        {
          parcel_status_history: { none: {} },
          updated_at: { lt: cutoff },
        },
      ],
    },
    select: { id: true, vendor_id: true, delivery_rider_id: true },
    take: 500,
  });

  if (candidates.length === 0) return { checked: 0, trashed: 0 };

  const ids = candidates.map((c) => c.id);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.parcels.updateMany({
      where: { id: { in: ids }, deleted_at: null },
      data: { deleted_at: now },
    });
    await tx.audit_logs.createMany({
      data: ids.map((id) => ({
        entity_type: "parcel",
        entity_id: id,
        action: "TRASH_ORDER_AUTO",
        new_data: {
          reason: `cancelled for more than ${CANCELLED_TRASH_AFTER_DAYS} days`,
          trashedAt: now.toISOString(),
        },
      })),
    });
    return updated.count;
  });

  if (result > 0) {
    await invalidateOrderCaches();
    await Promise.all(
      candidates.map((c) => invalidateTrashFinanceCaches(c)),
    );
  }
  return { checked: candidates.length, trashed: result };
}
