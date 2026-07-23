import { parcel_status, Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import redis, { scanAndDelete } from "../lib/redis";
import { AppError } from "../utils/AppError";
import { getSlaSettings, SLA_GROUPS } from "./sla.service";
import {
  BulkCreateOrderInput,
  BulkUpdateParcelStatusInput,
  CreateOrderInput,
  ListOrdersQuery,
  OrderPartyInput,
  OrderSortField,
  ParcelStatus,
  STATUS_TRANSITIONS,
  UpdateOrderDetailsInput,
  UpdateParcelStatusInput,
} from "../types/order.type";
import { generateTrackingId } from "../utils/trackingId";
import { generateDispatchNo } from "../utils/dispatchId";
import { generateRunSheetNo } from "../utils/runSheetNo";
import { NEPAL_UTC_OFFSET_MS, formatNepalDate as formatDate } from "../utils/nepalTime";
import { resolveOwnVendorId, isStaffActor } from "./vendor-scope.service";
import { invalidateVendorFinanceCache } from "./finance.service";
import { emitWebhookEvent } from "./webhookDispatch.service";

type Party = { name: string; phone: string; alternate_phone?: string | null };
function buildSearchText(trackingId: string, sender: Party, receiver: Party): string {
  return [
    trackingId,
    sender.name, sender.phone, sender.alternate_phone ?? "",
    receiver.name, receiver.phone, receiver.alternate_phone ?? "",
  ].join(" ").toLowerCase();
}
import { getDeliveryQuote } from "./delivery-rate.service";
import { getVendorQuote, getReturnDeliveryQuote, RateType, ServiceType } from "./pricing.service";

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

// Hold / Loss & Damage are only reachable from the ops dashboard's dedicated
// pages (HoldOperations / LossAndDamageOperations), both admin-gated in the
// UI — the API must enforce the same restriction, not just hide the buttons.
const OPS_RESTRICTED_STATUSES: parcel_status[] = ["hold", "loss_and_damage"];

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

const MAX_PAGE_SIZE = 100;
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
    for (const id of uniqueIds) {
      const key = `${PARCEL_STATUS_LOCK_PREFIX}${id}`;
      let acquired: string | null = "SKIPPED";
      try {
        acquired = await redis.set(key, "1", "EX", PARCEL_STATUS_LOCK_TTL_SECONDS, "NX");
      } catch (error) {
        console.error("[Redis] Parcel status lock acquisition failed, proceeding without lock:", error);
      }
      if (!acquired) {
        throw new AppError(409, "This order is being updated by another request - please retry.");
      }
      acquiredKeys.push(key);
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

async function createOrderCore(actor: OrderActor, data: CreateOrderInput) {
  return _createOrderImpl(actor, data);
}

// Same-day duplicate guard for interactive (single) order creation only - bulk
// imports go through createOrderCore and are intentionally exempt. Flags an
// order whose vendor already created one today for the same receiver
// (phone + name + address). Soft guard: throws a DUPLICATE_ORDER 409 the client
// turns into a "create anyway?" prompt, and is bypassed when the user confirms
// (data.confirmDuplicate) or when the order isn't attributed to a vendor.
async function assertNotDuplicateOrder(actor: OrderActor, data: CreateOrderInput) {
  if (data.confirmDuplicate) return;

  const ownVendorId = await resolveOwnVendorId(actor);
  const vendorId = ownVendorId ?? data.vendorId ?? null;
  if (!vendorId) return;

  const receiverPhone = data.receiver.phone.trim().replace(/\s/g, "");
  const receiverName = data.receiver.name.trim();
  const receiverAddress = data.receiver.address?.trim() ?? "";
  if (!receiverPhone || !receiverName) return;

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
        name: { equals: receiverName, mode: "insensitive" },
        ...(receiverAddress ? { address: { equals: receiverAddress, mode: "insensitive" } } : {}),
      },
    },
    orderBy: { created_at: "desc" },
    select: { order_number: true, tracking_id: true },
  });

  if (existing) {
    throw new AppError(
      409,
      `A similar order for ${receiverName} was already created today (Order #${existing.order_number}, ${existing.tracking_id}).`,
      "DUPLICATE_ORDER",
    );
  }
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

async function _createOrderImpl(actor: OrderActor, data: CreateOrderInput) {
  if (data.weightKg !== undefined && (!Number.isFinite(data.weightKg) || data.weightKg <= 0)) {
    throw new AppError(400, "weightKg must be a positive number");
  }
  if (data.codAmount !== undefined && (!Number.isFinite(data.codAmount) || data.codAmount < 0)) {
    throw new AppError(400, "codAmount cannot be negative");
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

  const resolvedOriginLocationId = data.originLocationId || data.sender.locationId || null;
  const resolvedDestinationLocationId = data.destinationLocationId || data.receiver.locationId || null;
  const weightKg = data.weightKg || 1;

  // A return parcel is goods the customer hands back for the vendor (created on
  // an exchange delivery or a return pickup). It never carries COD, so force it
  // to 0 regardless of what the caller passed. It still incurs a delivery charge
  // (a percent of the normal rate, see below) which is billed via settlement.
  const isReturnOrder = (data.orderType || "delivery") === "return";
  const codAmount = isReturnOrder ? 0 : data.codAmount || 0;

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
        delivery_charge: deliveryCharge,
        package_type: data.packageType || null,
        delivery_instruction: data.deliveryInstruction || null,
        created_by: actor.id,
      },
    });

    // All four secondary writes are independent — run them in parallel.
    await Promise.all([
      tx.parcel_status_history.create({
        data: {
          parcel_id: parcel.id,
          old_status: null,
          new_status: "pickup_ordered",
          location_id: parcel.current_location_id,
          changed_by: actor.id,
          remarks: "Order created",
        },
      }),
      tx.pickup_tasks.create({
        data: {
          parcel_id: parcel.id,
          pickup_address: data.pickupAddress || data.sender.address || null,
          scheduled_at: data.scheduledPickupAt ? new Date(data.scheduledPickupAt) : null,
          status: "pickup_ordered",
        },
      }),
      tx.cod_collections.create({
        data: {
          parcel_id: parcel.id,
          vendor_id: vendor?.id || null,
          cod_amount: codAmount,
          payment_status: "pending",
        },
      }),
      tx.audit_logs.create({
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
      }),
    ]);

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

  if (EDIT_BLOCKED_STATUSES.includes(parcel.status)) {
    throw new AppError(409, `Order can no longer be edited in status "${parcel.status}"`);
  }
  if (ownVendorId && !VENDOR_EDITABLE_STATUSES.includes(parcel.status)) {
    throw new AppError(409, "This parcel is already in the delivery network — contact support to change it");
  }

  const [originLoc, destinationLoc] = await Promise.all([
    data.originLocationId
      ? prisma.locations.findUnique({ where: { id: data.originLocationId } })
      : Promise.resolve(null),
    data.destinationLocationId
      ? prisma.locations.findUnique({ where: { id: data.destinationLocationId } })
      : Promise.resolve(null),
  ]);
  if (data.originLocationId && (!originLoc || !originLoc.is_active))
    throw new AppError(400, "Origin location not found or inactive");
  if (data.destinationLocationId && (!destinationLoc || !destinationLoc.is_active))
    throw new AppError(400, "Destination location not found or inactive");

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
  if (data.packageType !== undefined && data.packageType !== (parcel.package_type || undefined))
    note("package type", parcel.package_type, data.packageType);
  if (data.deliveryInstruction !== undefined && data.deliveryInstruction !== (parcel.delivery_instruction || undefined))
    note("delivery instruction", parcel.delivery_instruction, data.deliveryInstruction);

  if (changedFields.length === 0) return parcel;

  // Weight or destination changes re-price the parcel with the same waterfall
  // as order creation (vendor rate model, then route rate, else keep as-is).
  let deliveryCharge = Number(parcel.delivery_charge);
  const destinationLocationId = data.destinationLocationId ?? parcel.destination_location_id;
  const originLocationId = data.originLocationId ?? parcel.origin_location_id;
  const weightKg = data.weightKg ?? currentWeight ?? 1;
  const repriceNeeded =
    changedKeys.has("weight") || changedKeys.has("destination") || changedKeys.has("origin");
  if (repriceNeeded && destinationLocationId) {
    if (parcel.vendors) {
      const vendor = parcel.vendors;
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

  const updated = await prisma.$transaction(async (tx) => {
    let receiverId = parcel.receiver_id;
    let receiver = currentReceiver;
    if (data.receiver) {
      receiver = await upsertPartyByPhone(tx, data.receiver);
      receiverId = receiver.id;
    }

    const updatedParcel = await tx.parcels.update({
      where: { id: parcel.id },
      data: {
        receiver_id: receiverId,
        origin_location_id: originLocationId,
        destination_location_id: destinationLocationId,
        order_type: data.orderType ?? parcel.order_type,
        service_type: data.serviceType ?? parcel.service_type,
        pieces: data.pieces ?? parcel.pieces,
        weight_kg: weightKg,
        cod_amount: data.codAmount ?? parcel.cod_amount,
        delivery_charge: deliveryCharge,
        package_type: data.packageType !== undefined ? data.packageType || null : parcel.package_type,
        delivery_instruction:
          data.deliveryInstruction !== undefined ? data.deliveryInstruction || null : parcel.delivery_instruction,
        search_text: buildSearchText(parcel.tracking_id, parcel.parties_parcels_sender_idToparties, receiver),
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
            weightKg: currentWeight ?? null,
            deliveryCharge: Number(parcel.delivery_charge),
          },
          new_data: {
            changedFields,
            receiverId,
            destinationLocationId,
            codAmount: Number(updatedParcel.cod_amount),
            weightKg: Number(updatedParcel.weight_kg),
            deliveryCharge: Number(updatedParcel.delivery_charge),
          },
        },
      }),
    ];
    if (data.codAmount !== undefined && changedKeys.has("COD amount")) {
      writes.push(
        tx.cod_collections.updateMany({
          where: { parcel_id: parcel.id, payment_status: "pending" },
          data: { cod_amount: data.codAmount },
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

  return updated;
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
      chunk.map(({ data }) => createOrderCore(actor, data)),
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
  const conditions: Prisma.parcelsWhereInput[] = [{ deleted_at: null }];

  if (scope.vendorId) {
    conditions.push({ vendor_id: scope.vendorId });
  }
  // Sales accounts are scoped to a set of owned vendors. An empty set means
  // they own no clients yet, so they should see nothing.
  if (scope.vendorIds) {
    conditions.push({ vendor_id: { in: scope.vendorIds } });
  }
  if (scope.riderId) {
    conditions.push({
      OR: [{ pickup_rider_id: scope.riderId }, { delivery_rider_id: scope.riderId }],
    });
  }
  if (query.status?.length) {
    conditions.push({ status: { in: query.status as parcel_status[] } });
  }
  if (query.orderType) {
    conditions.push({ order_type: query.orderType });
  }

  const search = query.search?.trim();
  if (search) {
    const terms = search.split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length > 1) {
      conditions.push({
        OR: terms.map((t) => ({ tracking_id: { equals: t, mode: "insensitive" as const } })),
      });
    } else {
      // Single-column GIN trigram search — no JOINs, stays fast at any table size.
      // Covers: tracking_id, sender/receiver name, sender/receiver phone.
      conditions.push({
        search_text: { contains: search.toLowerCase(), mode: "insensitive" },
      });
    }
  }

  return { AND: conditions };
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
  // Only populated for exports, where the caller batch-fetches the first
  // "arrived at origin" timestamp per parcel (see fetchArrivedAtOriginMap).
  arrivedByParcelId?: Map<string, string>,
) {
  const latestHistory = parcel.parcel_status_history[0];
  const rider =
    parcel.riders_parcels_delivery_rider_idToriders ||
    parcel.riders_parcels_pickup_rider_idToriders;
  const vendorName = parcel.vendors?.business_name || parcel.vendors?.client_name || "";

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
    deliveryCharge: Number(parcel.delivery_charge),
    packageType: parcel.package_type || "",
    deliveryInstruction: parcel.delivery_instruction || "",
    vendorId: parcel.vendor_id,
    vendorName,
    vendorLocation: parcel.vendors?.pickup_landmark || "",
    riderName: rider?.name || "",
    remarks: parcel.parcel_remarks[0]?.remark || "",
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
  const isDefaultUnfilteredQuery =
    !paginated && !query.status?.length && !query.orderType && !query.search &&
    !query.sortBy && vendorIds === undefined;
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
      data: parcels.map((p) => mapOrder(p, isStaff, arrivedMap)),
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
    data: parcels.map((p) => mapOrder(p, isStaff)),
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

const RUN_SHEET_PARCEL_INCLUDE = {
  parties_parcels_receiver_idToparties: true,
  locations_parcels_destination_location_idTolocations: true,
  vendors: true,
} satisfies Prisma.parcelsInclude;

type RunSheetParcel = Prisma.parcelsGetPayload<{ include: typeof RUN_SHEET_PARCEL_INCLUDE }>;

function mapRunSheetParcel(parcel: RunSheetParcel) {
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
    deliveryInstruction: parcel.delivery_instruction || "",
    deliveredAt: parcel.delivered_at ? parcel.delivered_at.toISOString() : null,
  };
}

export type RunSheetParcelDto = ReturnType<typeof mapRunSheetParcel>;

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
        include: { parcels: { include: RUN_SHEET_PARCEL_INCLUDE } },
        orderBy: { created_at: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
    // Safety valve only - one day of hand-offs is inherently small.
    take: 500,
  });

  const mapped = sheets.map((sheet) => {
    const parcels = sheet.run_sheet_parcels.map((link) => mapRunSheetParcel(link.parcels));
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
} satisfies Prisma.parcelsInclude;

// Internal staff whose real names must never surface to vendors/riders - their
// remarks and status changes are attributed to a generic "Staff" instead.
const STAFF_ROLE_CODES = new Set(["super_admin", "admin"]);

// NCM 3PL bookkeeping remarks. The handoff remark is an internal audit/link
// row (see ncm.service.ts) and must not show in the user-facing thread.
// Inbound NCM-staff comments carry a "[NCM Staff]" tag we strip for display,
// attributing them to a generic "Staff" (they have no local user).
const NCM_HANDOFF_PREFIX = "[NCM] Handed off";
const NCM_STAFF_PREFIX = "[NCM Staff]";

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
      ...(riderId ? { OR: [{ pickup_rider_id: riderId }, { delivery_rider_id: riderId }] } : {}),
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

  return {
    ...mapOrder(parcel, isStaff),
    canChangeStatus: isStaff,
    priceLog,
    // Staff see the real author name; vendors/riders see a generic "Staff"
    // label in place of any internal staff member's name (their own / other
    // non-staff authors still show normally).
    remarks: parcel.parcel_remarks
      .filter((remark) => !remark.remark.startsWith(NCM_HANDOFF_PREFIX))
      .map((remark) => {
      const isNcmStaff = remark.remark.startsWith(NCM_STAFF_PREFIX);
      const remarkText = isNcmStaff
        ? remark.remark.slice(NCM_STAFF_PREFIX.length).trim()
        : remark.remark;
      const maskAuthor = !isStaff && isStaffAuthor(remark.users);
      const maskParent = !isStaff && isStaffAuthor(remark.parent_remark?.users);
      return {
        id: remark.id,
        remark: remarkText,
        addedBy: isNcmStaff ? "Staff" : maskAuthor ? "Staff" : remark.users?.full_name || "Unknown",
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
        remarks: entry.remarks || "",
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
      ...(riderId ? { OR: [{ pickup_rider_id: riderId }, { delivery_rider_id: riderId }] } : {}),
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
    addedBy: remark.users?.full_name || "Unknown",
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
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const parcelWhere: Prisma.parcelsWhereInput = {
    deleted_at: null,
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    ...(riderId
      ? {
          OR: [
            { pickup_rider_id: riderId },
            { delivery_rider_id: riderId },
          ],
        }
      : {}),
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

  // Same scope (vendor/rider/none) as parcelWhere above, expressed as raw SQL so
  // it can be reused across both consolidated queries below. Casting the enum
  // columns to text and comparing against plain string arrays sidesteps
  // Postgres enum-array parameter binding, which $queryRaw doesn't infer well.
  const parcelScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? Prisma.sql`AND (pickup_rider_id = ${riderId}::uuid OR delivery_rider_id = ${riderId}::uuid)`
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
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered'])) AS total_delivered,
      COUNT(*) FILTER (WHERE status::text NOT IN ('pickup_ordered','rider_assigned','failed_pickup','cancelled')) AS total_picked_up,
      COUNT(*) FILTER (WHERE order_type::text = 'return') AS total_returns,
      COUNT(*) FILTER (WHERE status::text = 'returned_to_vendor') AS total_returned_to_vendor,
      COUNT(*) FILTER (WHERE created_at >= ${todayStart}) AS todays_orders,
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${todayStart}) AS todays_delivered,
      COUNT(*) FILTER (WHERE order_type::text = 'return' AND created_at >= ${todayStart}) AS todays_returns,
      COALESCE(SUM(cod_amount), 0) AS total_order_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${PICKUP_PENDING_STATUSES})), 0) AS pending_pickups_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${RETURN_PENDING_STATUSES})), 0) AS pending_returns_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${IN_TRANSIT_STATUSES})), 0) AS in_transit_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered'])), 0) AS total_delivered_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE order_type::text = 'return'), 0) AS total_returns_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = 'returned_to_vendor'), 0) AS total_returned_to_vendor_amount
    FROM parcels
    WHERE deleted_at IS NULL ${parcelScopeSql}
  `);

  const totalOrders = Number(overviewRow!.total_orders);
  const pendingPickups = Number(overviewRow!.pending_pickups);
  const pendingReturns = Number(overviewRow!.pending_returns);
  const inTransit = Number(overviewRow!.in_transit);
  const pendingDeliveries = Number(overviewRow!.pending_deliveries);
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
    ? Prisma.sql`AND (p.pickup_rider_id = ${riderId}::uuid OR p.delivery_rider_id = ${riderId}::uuid)`
    : Prisma.empty;

  const [todaysRemarks, unclosedComments, codRows, pendingCodCount, lastSettlement, returnedTodayRows] = await Promise.all([
    prisma.parcel_remarks.count({
      where: { created_at: { gte: todayStart }, parcels: parcelWhere },
    }),
    prisma.support_tickets.count({
      where: {
        status: { notIn: ["resolved", "closed"] },
        ...(vendorId || riderId ? { parcels: parcelWhere } : {}),
      },
    }),
    prisma.$queryRaw<
      Array<{
        total_collected: string;
        settled_to_vendor: string;
        settled_to_rider: string;
        cod_from_rider: string;
        pending_delivery_charge: string;
        total_delivery_charge: string;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(c.collected_amount), 0) AS total_collected,
        COALESCE(SUM(LEAST(c.remitted_amount, c.collected_amount)), 0) AS settled_to_vendor,
        COALESCE(SUM(LEAST(c.rider_remitted_amount, c.collected_amount)), 0) AS settled_to_rider,
        COALESCE(SUM(c.collected_amount - LEAST(c.rider_remitted_amount, c.collected_amount)), 0) AS cod_from_rider,
        COALESCE(SUM(p.delivery_charge) FILTER (WHERE c.payment_status::text = 'pending'), 0) AS pending_delivery_charge,
        COALESCE(SUM(p.delivery_charge), 0) AS total_delivery_charge
      FROM cod_collections c
      JOIN parcels p ON p.id = c.parcel_id
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

  // Cash riders have collected but not yet remitted to the office - shown on
  // the admin card alongside the settled/pending vendor figures.
  const codFromRider = Number(codRow?.cod_from_rider ?? 0);

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
    overdueRemarks = await prisma.parcel_remarks.count({
      where: {
        workflow_status: { not: "closed" },
        created_at: { lt: remarksCutoff },
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
      codFromRider,
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

  const txOutcome = await prisma.$transaction(async (tx) => {
    let createdReturn: { id: string; trackingId: string } | null = null;
    const updateData: Prisma.parcelsUpdateInput = {
      status: newStatus as parcel_status,
    };
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
    // Side-effect: record what the rider actually collected on delivery, so
    // the COD settlement ledger (cod_collections) reflects real cash in hand
    // instead of staying at its order-creation defaults forever.
    if ((newStatus === "delivered" || newStatus === "partially_delivered") && parcel.delivery_rider_id) {
      const collectedAmount = newStatus === "delivered" ? Number(parcel.cod_amount) : (data.codCollected ?? 0);
      if (collectedAmount > 0) {
        // upsert, not update: a cod_collections row should always exist (created
        // atomically at order creation), but this must never block the delivery
        // transition itself if some legacy/drifted parcel is missing one.
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
            collected_amount: collectedAmount,
            collected_at: new Date(),
          },
        });
      }
    }
    // Side-effect: update pickup_task status in sync
    if (parcel.pickup_tasks && ["rider_assigned", "picked_up", "cancelled"].includes(newStatus)) {
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
        await Promise.all([
          tx.cod_collections.create({
            data: { parcel_id: ret.id, vendor_id: parcel.vendor_id, cod_amount: 0, payment_status: "pending" },
          }),
          tx.pickup_tasks.create({
            data: { parcel_id: ret.id, pickup_address: null, status: "picked_up" },
          }),
          tx.parcel_status_history.create({
            data: {
              parcel_id: ret.id,
              old_status: null,
              new_status: "picked_up",
              location_id: parcel.destination_location_id,
              changed_by: actor.id,
              remarks: `Return auto-created from exchange order ${parcel.tracking_id}`,
            },
          }),
          tx.audit_logs.create({
            data: {
              actor_id: actor.id,
              entity_type: "parcel",
              entity_id: ret.id,
              action: "CREATE_RETURN_ORDER",
              new_data: { trackingId: ret.tracking_id, sourceOrderId: parcel.id, sourceTrackingId: parcel.tracking_id },
            },
          }),
        ]);
      }
    }
    return { updatedParcel, createdReturn };
  });

  const { updatedParcel, createdReturn } = txOutcome;

  await invalidateOrderCaches();

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

  const parcels = await prisma.parcels.findMany({
    where: {
      id: { in: ids },
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    },
    include: { pickup_tasks: true, locations_parcels_destination_location_idTolocations: true },
  });

  if (parcels.length !== ids.length) {
    throw new AppError(404, "One or more parcels were not found or do not belong to your account");
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

  let toLocationId: string | null = null;
  let originLocationId: string | null = null;
  let riderId: string | null = null;

  if (newStatus === "dispatched") {
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

    const updateData: Prisma.parcelsUpdateInput = { status: newStatus as parcel_status };
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
    // Each hand-off to a delivery rider counts as one delivery attempt.
    if (newStatus === "sent_for_delivery") {
      (updateData as any).attempt_count = { increment: 1 };
    }

    // A batch hand-off to a delivery rider opens one run sheet for the batch.
    if (newStatus === "sent_for_delivery" && parcelRiderId) {
      await createRunSheet(tx, parcelRiderId, ids, actor.id);
    }

    await tx.parcels.updateMany({
      where: { id: { in: ids } },
      data: updateData,
    });

    // Tag the COD record with whichever rider is now responsible for
    // collecting it, so rider-scoped COD/finance queries can find it -
    // nothing else in the app ever sets cod_collections.rider_id otherwise.
    if (riderAssignmentField === "delivery_rider_id" && parcelRiderId) {
      await tx.cod_collections.updateMany({
        where: { parcel_id: { in: ids } },
        data: { rider_id: parcelRiderId },
      });
    }

    // Side-effect: record what each rider actually collected on delivery, so
    // the COD settlement ledger (cod_collections) reflects real cash in hand
    // instead of staying at its order-creation defaults forever. Amounts can
    // differ per parcel (full cod_amount vs the shared partial codCollected),
    // so this can't be a single updateMany.
    if (newStatus === "delivered" || newStatus === "partially_delivered") {
      const collectedAt = new Date();
      await Promise.all(
        parcels
          .filter((p) => p.delivery_rider_id)
          .map((p) => {
            const collectedAmount = newStatus === "delivered" ? Number(p.cod_amount) : (data.codCollected ?? 0);
            if (collectedAmount <= 0) return Promise.resolve();
            return tx.cod_collections.upsert({
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
                collected_amount: collectedAmount,
                collected_at: collectedAt,
              },
            });
          }),
      );
    }

    const pickupSyncIds = parcels
      .filter((p) => p.pickup_tasks && ["rider_assigned", "picked_up", "cancelled"].includes(newStatus))
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
        remarks: data.remarks || null,
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
    // newStatus is shared across the whole batch.
    const changedAt = new Date().toISOString();
    for (const p of parcels) {
      if (!p.vendor_id) continue;
      await emitWebhookEvent(tx, p.vendor_id, "order.status_changed", {
        trackingId: p.tracking_id,
        orderId: p.id,
        vendorId: p.vendor_id,
        oldStatus: p.status,
        newStatus,
        changedAt,
      });
    }

    // Close out manifests once none of their parcels are still "dispatched" -
    // one groupBy instead of a per-dispatch count()+updateMany() loop, since
    // the loop was issuing N sequential round trips while holding transaction locks.
    if (newStatus === "arrived_at_branch") {
      const links = await tx.dispatch_parcels.findMany({
        where: { parcel_id: { in: ids } },
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

    return {
      updatedCount: parcels.length,
      status: newStatus,
      ...(dispatch && toLocationId
        ? { dispatch: { id: dispatch.id, dispatchNo: dispatch.dispatch_no, toLocationId } }
        : {}),
    };
  });

  await invalidateOrderCaches();

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

    await prisma.$transaction(async (tx) => {
      const updateData: Prisma.parcelsUpdateInput = { status: targetStatus };
      if (targetStatus === "delivered") {
        (updateData as any).delivered_at = new Date();
      }
      await tx.parcels.update({ where: { id: parcelId }, data: updateData });
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
      await tx.parcels.update({ where: { id: parcelId }, data: { status: "follow_up" } });
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
