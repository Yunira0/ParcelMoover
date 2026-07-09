import { parcel_status, Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import redis, { scanAndDelete } from "../lib/redis";
import { AppError } from "../utils/AppError";
import {
  BulkCreateOrderInput,
  BulkUpdateParcelStatusInput,
  CreateOrderInput,
  ListOrdersQuery,
  OrderPartyInput,
  OrderSortField,
  ParcelStatus,
  STATUS_TRANSITIONS,
  UpdateParcelStatusInput,
} from "../types/order.type";
import { generateTrackingId } from "../utils/trackingId";
import { generateDispatchNo } from "../utils/dispatchId";
import { generateRunSheetNo } from "../utils/runSheetNo";
import { resolveOwnVendorId } from "./vendor-scope.service";
import { invalidateVendorFinanceCache } from "./finance.service";

type Party = { name: string; phone: string; alternate_phone?: string | null };
function buildSearchText(trackingId: string, sender: Party, receiver: Party): string {
  return [
    trackingId,
    sender.name, sender.phone, sender.alternate_phone ?? "",
    receiver.name, receiver.phone, receiver.alternate_phone ?? "",
  ].join(" ").toLowerCase();
}
import { getDeliveryQuote } from "./delivery-rate.service";
import { getVendorQuote, RateType } from "./pricing.service";
import { createNotification } from "./notification.service";

type OrderActor = {
  id: string;
  roles: string[];
};

const MAX_TRACKING_ID_RETRIES = 5;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hrs

const PICKUP_PENDING_STATUSES: parcel_status[] = ["pickup_ordered", "rider_assigned"];

const IN_TRANSIT_STATUSES: parcel_status[] = [
  "picked_up",
  "arrived",
  "dispatched",
  "arrived_at_branch",
  "ready_to_deliver",
  "sent_for_delivery",
  "oov",
];

const DELIVERY_PENDING_STATUSES: parcel_status[] = [
  "ready_to_deliver",
  "sent_for_delivery",
  "oov",
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

const OPEN_STATUSES: parcel_status[] = [
  "pickup_ordered",
  "rider_assigned",
  "picked_up",
  "arrived",
  "ready_to_deliver",
  "sent_for_delivery",
  "partially_delivered",
  "oov",
  "dispatched",
  "arrived_at_branch",
  "hold",
  "loss_and_damage",
];

const locationName = (location?: { name: string; city: string | null; district: string | null } | null) => {
  if (!location) return "";
  return [location.name, location.city || location.district].filter(Boolean).join(", ");
};

// Nepal Standard Time is a fixed UTC+5:45 offset (no DST). Shifting by it
// before truncating to a calendar day keeps the reported "day" aligned with
// Nepal local time regardless of the server host's own timezone - without
// this, orders created between midnight and 5:45am NPT get bucketed into the
// previous UTC day, one day off from what a vendor filtering "today" expects.
const NEPAL_UTC_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const formatDate = (date?: Date | null) =>
  date ? new Date(date.getTime() + NEPAL_UTC_OFFSET_MS).toISOString().slice(0, 10) : "";

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
) {
  const normalizedPhone = partyData.phone.trim().replace(/\s/g, "");

  const existing = await tx.parties.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { created_at: "desc" },
  });

  if (existing) {
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

export async function createOrder(actor: OrderActor, data: CreateOrderInput) {
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

  // Run the remaining two independent reads in parallel.
  const [vendor, originLoc, destinationLoc] = await Promise.all([
    ownVendorId
      ? prisma.vendors.findFirst({
          where: { id: ownVendorId, deleted_at: null, status: "active" },
        })
      : data.vendorId
      ? prisma.vendors.findFirst({
          where: { id: data.vendorId, deleted_at: null, status: "active" },
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

  // Payable is computed server-side so the client can't spoof the charge. Vendor
  // orders price by the vendor's chosen rate model (per-destination / zone / flat);
  // non-vendor orders fall back to the legacy origin→destination route rate, then
  // to a manually supplied charge when no rate can be resolved.
  let deliveryCharge = data.deliveryCharge || 0;
  if (vendor && resolvedDestinationLocationId) {
    const quote = await getVendorQuote(vendor.rate_type as RateType, resolvedDestinationLocationId, weightKg, {
      flatInsideValley: vendor.flat_inside_valley === null ? null : Number(vendor.flat_inside_valley),
      flatOutsideValley: vendor.flat_outside_valley === null ? null : Number(vendor.flat_outside_valley),
      zoneMajorCities: vendor.zone_major_cities === null ? null : Number(vendor.zone_major_cities),
      zoneUrbanAreas: vendor.zone_urban_areas === null ? null : Number(vendor.zone_urban_areas),
      zoneRemoteAreas: vendor.zone_remote_areas === null ? null : Number(vendor.zone_remote_areas),
      extraWeightPercent: vendor.extra_weight_percent === null ? null : Number(vendor.extra_weight_percent),
    });
    deliveryCharge = quote.totalPayable;
  } else if (resolvedOriginLocationId && resolvedDestinationLocationId) {
    const quote = await getDeliveryQuote(resolvedOriginLocationId, resolvedDestinationLocationId, weightKg);
    deliveryCharge = quote.totalPayable;
  }

  const parcel = await prisma.$transaction(async (tx) => {
    const trackingId = await generateUniqueTrackingId(tx);

    const [sender, receiver] = await Promise.all([
      findOrCreateParty(tx, data.sender),
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
        service_type: data.serviceType || "dtd",
        status: "pickup_ordered",
        pieces: data.pieces || 1,
        weight_kg: weightKg,
        cod_amount: data.codAmount || 0,
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
          cod_amount: data.codAmount || 0,
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

  return parcel;
}

const BULK_CREATE_MAX = 100;

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
  > = [];
  const vendorIdsToInvalidate = new Set<string>();

  for (let i = 0; i < input.orders.length; i++) {
    if (signal?.aborted) {
      // Client disconnected - stop opening new transactions for orders it'll
      // never see the result of. Record the remainder as not-processed
      // rather than silently omitting them, so this (still-cached, since
      // it's not an error) response stays honest about what happened; a
      // genuinely new attempt needs a fresh Idempotency-Key, not a retry of
      // this one, since some of this batch already committed.
      for (let j = i; j < input.orders.length; j++) {
        results.push({ index: j, success: false, error: "Not processed - request was cancelled by the client" });
        failed++;
      }
      break;
    }

    const raw = input.orders[i]!;
    // Merge defaultSender only when the order doesn't supply its own sender.
    const resolvedSender: OrderPartyInput | undefined =
      raw.sender?.phone ? raw.sender : input.defaultSender;

    if (!resolvedSender?.name || !resolvedSender?.phone) {
      results.push({ index: i, success: false, error: "Sender name and phone are required" });
      failed++;
      continue;
    }

    if (!raw.receiver?.name || !raw.receiver?.phone) {
      results.push({ index: i, success: false, error: "Receiver name and phone are required" });
      failed++;
      continue;
    }

    const orderData: CreateOrderInput = {
      ...raw,
      sender: resolvedSender,
      receiver: raw.receiver,
    };

    try {
      const parcel = await createOrderCore(actor, orderData);
      results.push({ index: i, success: true, trackingId: parcel.tracking_id });
      created++;
      if (parcel.vendor_id) vendorIdsToInvalidate.add(parcel.vendor_id);
    } catch (err: any) {
      results.push({ index: i, success: false, error: err.message || "Order creation failed" });
      failed++;
    }
  }

  // Flush caches once for the whole batch instead of after each individual order.
  if (created > 0) {
    await invalidateOrderCaches();
    await Promise.all(Array.from(vendorIdsToInvalidate, (id) => invalidateVendorFinanceCache(id)));
  }

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
    include: { users: true },
  },
} satisfies Prisma.parcelsInclude;

export interface ListOrdersResult {
  data: ReturnType<typeof mapOrder>[];
  meta?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    // Set when the caller didn't ask for pagination and the result was capped -
    // lets the UI show "showing 200 of N" instead of silently looking complete.
    truncated?: boolean;
  };
}

function mapOrder(
  parcel: Prisma.parcelsGetPayload<{ include: typeof ORDERS_INCLUDE }>,
  isStaff: boolean,
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
  const lastUpdatedBy = isStaff
    ? latestHistory?.users?.full_name || ""
    : locationName(parcel.locations_parcels_origin_location_idTolocations) || vendorName || "Branch";

  return {
    id: parcel.id,
    orderNumber: parcel.order_number,
    trackingId: parcel.tracking_id,
    status: parcel.status,
    orderType: parcel.order_type,
    serviceType: parcel.service_type,
    senderName: parcel.parties_parcels_sender_idToparties.name,
    senderPhone: parcel.parties_parcels_sender_idToparties.phone,
    receiverName: parcel.parties_parcels_receiver_idToparties.name,
    receiverPhone: parcel.parties_parcels_receiver_idToparties.phone,
    origin:
      locationName(parcel.locations_parcels_origin_location_idTolocations) ||
      parcel.parties_parcels_sender_idToparties.address ||
      "",
    destination:
      locationName(parcel.locations_parcels_destination_location_idTolocations) ||
      parcel.parties_parcels_receiver_idToparties.address ||
      "",
    pieces: parcel.pieces,
    weightKg: parcel.weight_kg === null ? undefined : Number(parcel.weight_kg),
    codAmount: Number(parcel.cod_amount),
    deliveryCharge: Number(parcel.delivery_charge),
    packageType: parcel.package_type || "",
    deliveryInstruction: parcel.delivery_instruction || "",
    vendorName,
    riderName: rider?.name || "",
    remarks: parcel.parcel_remarks[0]?.remark || "",
    lastUpdatedBy,
    lastUpdatedAt: formatDate(latestHistory?.created_at || parcel.updated_at),
    createdAt: formatDate(parcel.created_at),
  };
}

// Allow-listed so a client can only sort by a column that's actually indexed
// or cheap to sort, never an arbitrary/unindexed field.
const ORDER_SORT_COLUMNS: Record<OrderSortField, keyof Prisma.parcelsOrderByWithRelationInput> = {
  createdAt: "created_at",
  codAmount: "cod_amount",
  deliveryCharge: "delivery_charge",
  trackingId: "tracking_id",
  status: "status",
};

function resolveOrdersOrderBy(query: ListOrdersQuery): Prisma.parcelsOrderByWithRelationInput {
  const column = query.sortBy ? ORDER_SORT_COLUMNS[query.sortBy] : "created_at";
  const direction = query.sortDir === "asc" ? "asc" : "desc";
  return { [column]: direction };
}

export async function listOrders(
  actor: OrderActor,
  query: ListOrdersQuery = {},
): Promise<ListOrdersResult> {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");
  const where = buildOrdersWhere({ vendorId, vendorIds, riderId }, query);
  const orderBy = resolveOrdersOrderBy(query);

  // Pagination only kicks in when the caller explicitly asks for it, so
  // existing callers that expect a flat array keep working unchanged.
  const paginated = query.page !== undefined || query.pageSize !== undefined;

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
  const cacheKey = isDefaultUnfilteredQuery ? ordersListCacheKey(vendorId, riderId) : null;

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
    const result: ListOrdersResult = {
      data: parcels.map((p) => mapOrder(p, isStaff)),
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

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize || DEFAULT_PAGE_SIZE));

  const [total, parcels] = await Promise.all([
    prisma.parcels.count({ where }),
    prisma.parcels.findMany({
      where,
      include: ORDERS_INCLUDE,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: parcels.map((p) => mapOrder(p, isStaff)),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
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
    include: { users: true, parent_remark: { include: { users: true } } },
  },
  parcel_status_history: {
    orderBy: { created_at: "desc" as const },
    include: { users: true, locations: true },
  },
} satisfies Prisma.parcelsInclude;

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

  return {
    ...mapOrder(parcel, isStaff),
    canChangeStatus: isStaff,
    remarks: parcel.parcel_remarks.map((remark) => ({
      id: remark.id,
      remark: remark.remark,
      addedBy: remark.users?.full_name || "Unknown",
      createdAt: formatDate(remark.created_at),
      parentRemarkId: remark.parent_remark_id,
      parentAuthor: remark.parent_remark?.users?.full_name || null,
      parentSnippet: remark.parent_remark?.remark || null,
    })),
    // Staff see who (which user) changed the status; vendors/riders only see
    // which branch/company made the change - never an internal staff member's name.
    statusHistory: parcel.parcel_status_history.map((entry) => {
      const branchLabel = entry.locations?.name || vendorName || "Branch";
      return {
        id: entry.id,
        oldStatus: entry.old_status,
        newStatus: entry.new_status,
        remarks: entry.remarks || "",
        changedBy: isStaff ? entry.users?.full_name || "System" : branchLabel,
        changedByType: isStaff ? ("user" as const) : ("branch" as const),
        createdAt: formatDate(entry.created_at),
      };
    }),
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
    include: { users: true, parent_remark: { include: { users: true } } },
  });

  const parentAuthorId = remark.parent_remark?.users?.id;
  if (parentAuthorId && parentAuthorId !== actor.id) {
    await createNotification(
      parentAuthorId,
      `New reply on order ${parcel.tracking_id}`,
      trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed,
      parcel.tracking_id,
    );
  }

  // Fire-and-forget: dynamic import avoids a static circular dependency with
  // ncm.service.ts (which itself imports from this file), and syncRemarkToNcm
  // is best-effort/self-catching, so a slow or unreachable NCM must never
  // delay this response.
  void import("./ncm.service").then(({ syncRemarkToNcm }) =>
    syncRemarkToNcm(parcel.id, `${remark.users?.full_name || "Staff"}: ${trimmed}`),
  );

  return {
    id: remark.id,
    remark: remark.remark,
    addedBy: remark.users?.full_name || "Unknown",
    createdAt: formatDate(remark.created_at),
    parentRemarkId: remark.parent_remark_id,
    parentAuthor: remark.parent_remark?.users?.full_name || null,
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
      todays_orders: bigint;
      todays_delivered: bigint;
      todays_returns: bigint;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE status::text = ANY(${PICKUP_PENDING_STATUSES})) AS pending_pickups,
      COUNT(*) FILTER (WHERE order_type::text = 'return' AND status::text = ANY(${OPEN_STATUSES})) AS pending_returns,
      COUNT(*) FILTER (WHERE status::text = ANY(${IN_TRANSIT_STATUSES})) AS in_transit,
      COUNT(*) FILTER (WHERE status::text = ANY(${DELIVERY_PENDING_STATUSES})) AS pending_deliveries,
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered'])) AS total_delivered,
      COUNT(*) FILTER (WHERE status::text NOT IN ('pickup_ordered','rider_assigned','failed_pickup','cancelled')) AS total_picked_up,
      COUNT(*) FILTER (WHERE order_type::text = 'return') AS total_returns,
      COUNT(*) FILTER (WHERE created_at >= ${todayStart}) AS todays_orders,
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${todayStart}) AS todays_delivered,
      COUNT(*) FILTER (WHERE order_type::text = 'return' AND created_at >= ${todayStart}) AS todays_returns
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
  const todaysOrders = Number(overviewRow!.todays_orders);
  const todaysDelivered = Number(overviewRow!.todays_delivered);
  const todaysReturns = Number(overviewRow!.todays_returns);

  // Same consolidation for the weekly/monthly trend: previously 4 queries per
  // day (up to 120 for the 30-day view), now one query with 4 conditional
  // aggregates per day. Column aliases are loop-index-derived, never
  // user-supplied, so Prisma.raw here isn't an injection risk.
  const trendSelects = trendDayRanges.map(({ start, end }, i) => Prisma.sql`
    COUNT(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS ${Prisma.raw(`d${i}_total`)},
    COUNT(*) FILTER (WHERE picked_up_at >= ${start} AND picked_up_at < ${end}) AS ${Prisma.raw(`d${i}_picked_up`)},
    COUNT(*) FILTER (WHERE status::text = 'delivered' AND delivered_at >= ${start} AND delivered_at < ${end}) AS ${Prisma.raw(`d${i}_delivered`)},
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

  const [todaysRemarks, unclosedComments, codTotals, pendingCodCount, lastSettlement] = await Promise.all([
    prisma.parcel_remarks.count({
      where: { created_at: { gte: todayStart }, parcels: parcelWhere },
    }),
    prisma.support_tickets.count({
      where: {
        status: { notIn: ["resolved", "closed"] },
        ...(vendorId || riderId ? { parcels: parcelWhere } : {}),
      },
    }),
    prisma.cod_collections.aggregate({
      where: codWhere,
      _sum: {
        cod_amount: true,
        remitted_amount: true,
        pending_amount: true,
      },
    }),
    prisma.cod_collections.count({
      where: { ...codWhere, payment_status: "pending" },
    }),
    prisma.settlements.findFirst({
      where: settlementWhere,
      orderBy: [{ settlement_date: "desc" }, { created_at: "desc" }],
      select: { amount: true, settlement_date: true, created_at: true },
    }),
  ]);

  const totalCod = moneyToNumber(codTotals._sum.cod_amount);
  const settledCod = moneyToNumber(codTotals._sum.remitted_amount);
  const pendingCod = codTotals._sum.pending_amount === null
    ? Math.max(totalCod - settledCod, 0)
    : moneyToNumber(codTotals._sum.pending_amount);

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

  const summary = {
    overview: {
      totalOrders,
      pendingPickups,
      pendingReturns,
      inTransit,
      pendingDeliveries,
      totalDelivered,
      totalPickedUp,
      totalReturns,
    },
    today: {
      totalOrders: todaysOrders,
      delivered: todaysDelivered,
      inTransit,
      returns: todaysReturns,
      remarks: todaysRemarks,
      unclosedComments,
    },
    codSettlement: {
      totalCod,
      settledCod,
      pendingCod,
      pendingCodCount,
      progressPercent: totalCod > 0 ? (settledCod / totalCod) * 100 : 0,
      scopedToRider: Boolean(riderId),
      lastAmount: lastSettlement ? moneyToNumber(lastSettlement.amount) : 0,
      lastSettledAt: lastSettlement
        ? formatDate(lastSettlement.settlement_date || lastSettlement.created_at)
        : null,
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
    select: { id: true, business_name: true, client_name: true, phone: true, address: true, location_id: true },
  });
  if (!vendor) {
    throw new AppError(403, "Vendor profile not found or inactive");
  }

  return {
    id: vendor.id,
    name: vendor.business_name || vendor.client_name,
    phone: vendor.phone,
    address: vendor.address || "",
    locationId: vendor.location_id,
  };
}

export async function notifyVendorOfStatusChange(
  vendorId: string | null,
  trackingId: string,
  newStatus: ParcelStatus,
  actorId: string,
) {
  if (!vendorId) return;

  const vendor = await prisma.vendors.findUnique({
    where: { id: vendorId },
    select: { user_id: true },
  });

  if (!vendor?.user_id || vendor.user_id === actorId) return;

  await createNotification(
    vendor.user_id,
    `Order ${trackingId} updated`,
    `Status changed to '${newStatus}'.`,
    trackingId,
  );
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
    },
  });

  if (!parcel) {
    throw new AppError(404, "Parcel not found");
  }

  const currentStatus = parcel.status as ParcelStatus;
  const newStatus = data.status;
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  // A super_admin may force any status from any status (including out of a
  // terminal state) - the transition map only constrains everyone else.
  const isSuperAdmin = actor.roles.includes("super_admin");

  // Ownership scoping: vendors/vendor_staff may only touch their own parcels,
  // and riders may only touch parcels they're actually assigned to, and only
  // for the leg (pickup vs delivery) they were assigned for.
  if (!isAdmin) {
    const isVendorActor = actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
    const isRiderActor = actor.roles.includes("rider");

    if (isVendorActor) {
      const { vendorId } = await getActorScope(actor);
      if (parcel.vendor_id !== vendorId) {
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
  }

  //only admin aan cancel
  if (newStatus === "cancelled" && !isAdmin) {
    throw new AppError(403, "Only admins can cancel an order");
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

  const updatedParcel = await prisma.$transaction(async (tx) => {
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
    return updatedParcel;
  });

  await invalidateOrderCaches();
  await notifyVendorOfStatusChange(parcel.vendor_id, parcel.tracking_id, newStatus, actor.id);
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

  // Resolve vendor/rider scope so non-admins can only act on their own parcels.
  const { vendorId, riderId: actorRiderId } = isVendorActor || isRiderActor
    ? await getActorScope(actor)
    : { vendorId: undefined, riderId: undefined };

  if (isRiderActor && !actorRiderId) {
    throw new AppError(403, "Rider profile not found or inactive");
  }

  const parcels = await prisma.parcels.findMany({
    where: {
      id: { in: ids },
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
    },
    include: { pickup_tasks: true },
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

  const vendorIds = Array.from(
    new Set(parcels.map((p) => p.vendor_id).filter((id): id is string => Boolean(id))),
  );
  if (vendorIds.length) {
    const vendors = await prisma.vendors.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, user_id: true },
    });
    const vendorUserIdById = new Map(vendors.map((v) => [v.id, v.user_id]));

    await Promise.all(
      parcels.map((p) => {
        const vendorUserId = p.vendor_id ? vendorUserIdById.get(p.vendor_id) : null;
        if (!vendorUserId || vendorUserId === actor.id) return Promise.resolve();
        return createNotification(
          vendorUserId,
          `Order ${p.tracking_id} updated`,
          `Status changed to '${newStatus}'.`,
          p.tracking_id,
        );
      }),
    );
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
    });

    await invalidateOrderCaches();
    if (targetStatus === "delivered" && parcel.vendor_id) {
      invalidateVendorFinanceCache(parcel.vendor_id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
    }
    await notifyVendorOfStatusChange(parcel.vendor_id, parcel.tracking_id, targetStatus, "");
    return { applied: true };
  });
}
