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
import { NEPAL_UTC_OFFSET_MS, formatNepalDate as formatDate } from "../utils/nepalTime";
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

// Hub-level transitions: building/closing a dispatch manifest is a branch
// operation, not something a delivery rider should be able to trigger.
const HUB_OPERATION_STATUSES: parcel_status[] = ["dispatched", "arrived_at_branch"];

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

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;
const MAX_BULK_IDS = 200;

const DASHBOARD_SUMMARY_CACHE_PREFIX = "dashboard:summary:";
const DASHBOARD_SUMMARY_TTL_SECONDS = 30;

const ORDERS_LIST_CACHE_PREFIX = "orders:list:";
const ORDERS_LIST_TTL_SECONDS = 20;

function dashboardSummaryCacheKey(vendorId?: string, riderId?: string) {
  return `${DASHBOARD_SUMMARY_CACHE_PREFIX}${vendorId ?? "none"}:${riderId ?? "none"}`;
}

// Only the default, unfiltered/unpaginated listOrders() call is cached, so the
// scope (vendor/rider) is all that distinguishes one cached list from another.
function ordersListCacheKey(vendorId?: string, riderId?: string) {
  return `${ORDERS_LIST_CACHE_PREFIX}${vendorId ?? "none"}:${riderId ?? "none"}`;
}

// Best-effort: a Redis hiccup should never block a status update or fall
// back to a 503 - the dashboard/list just serve a stale value until the TTL expires.
async function invalidateOrderCaches() {
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

// Each order runs its own multi-query transaction (tracking id, party lookup,
// rate quote, parcel + 4 secondary writes). Running all of them fully
// sequentially serializes ~12+ round trips per order across the whole batch,
// which risks request timeouts at BULK_CREATE_MAX. Capped concurrency keeps
// orders isolated (one failing order still can't affect another) while
// staying well under the DB pool's connection limit (20 - see lib/prisma.ts).
const BULK_CREATE_CONCURRENCY = 5;

export async function bulkCreateOrders(actor: OrderActor, input: BulkCreateOrderInput) {
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
) {
  const latestHistory = parcel.parcel_status_history[0];
  const rider =
    parcel.riders_parcels_delivery_rider_idToriders ||
    parcel.riders_parcels_pickup_rider_idToriders;

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
    vendorName: parcel.vendors?.business_name || parcel.vendors?.client_name || "",
    riderName: rider?.name || "",
    remarks: parcel.parcel_remarks[0]?.remark || "",
    lastUpdatedBy: latestHistory?.users?.full_name || "",
    lastUpdatedAt: formatDate(latestHistory?.created_at || parcel.updated_at),
    createdAt: formatDate(parcel.created_at),
  };
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
      data: parcels.map(mapOrder),
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
    data: parcels.map(mapOrder),
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
    const delivered = parcels.filter((p) => p.status === "delivered");
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
    ...mapOrder(parcel),
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

export async function getDashboardSummary(actor: OrderActor) {
  const { vendorId, vendorIds, riderId } = await getActorScope(actor);
  // Sales scope is per-account; skip the shared cache to avoid cross-account leaks.
  const cacheKey = vendorIds === undefined ? dashboardSummaryCacheKey(vendorId, riderId) : null;

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

  const TREND_DAYS = 7;
  const trendDayRanges = Array.from({ length: TREND_DAYS }, (_, index) => {
    const offset = TREND_DAYS - 1 - index;
    const start = new Date(todayStart);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  });

  const [
    totalOrders,
    pendingPickups,
    pendingReturns,
    inTransit,
    pendingDeliveries,
    totalDelivered,
    totalPickedUp,
    totalReturns,
    todaysOrders,
    todaysDelivered,
    todaysReturns,
    todaysRemarks,
    unclosedComments,
    codTotals,
    pendingCodCount,
    lastSettlement,
    trendCounts,
    orderAmountTotals,
    pendingPickupsAmountTotals,
    pendingReturnsAmountTotals,
    inTransitAmountTotals,
    deliveredAmountTotals,
    returnsAmountTotals,
  ] = await Promise.all([
    prisma.parcels.count({ where: parcelWhere }),
    prisma.parcels.count({
      where: { ...parcelWhere, status: { in: PICKUP_PENDING_STATUSES } },
    }),
    prisma.parcels.count({
      where: {
        ...parcelWhere,
        order_type: "return",
        status: { in: OPEN_STATUSES },
      },
    }),
    prisma.parcels.count({
      where: { ...parcelWhere, status: { in: IN_TRANSIT_STATUSES } },
    }),
    prisma.parcels.count({
      where: { ...parcelWhere, status: { in: DELIVERY_PENDING_STATUSES } },
    }),
    prisma.parcels.count({
      where: { ...parcelWhere, status: "delivered" },
    }),
    prisma.parcels.count({
      where: {
        ...parcelWhere,
        status: { notIn: ["pickup_ordered", "rider_assigned", "failed_pickup", "cancelled"] },
      },
    }),
    prisma.parcels.count({
      where: { ...parcelWhere, order_type: "return" },
    }),
    prisma.parcels.count({
      where: { ...parcelWhere, created_at: { gte: todayStart } },
    }),
    prisma.parcels.count({
      where: {
        ...parcelWhere,
        status: "delivered",
        delivered_at: { gte: todayStart },
      },
    }),
    prisma.parcels.count({
      where: {
        ...parcelWhere,
        order_type: "return",
        created_at: { gte: todayStart },
      },
    }),
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
    Promise.all(
      trendDayRanges.map(({ start, end }) =>
        Promise.all([
          prisma.parcels.count({
            where: {
              ...parcelWhere,
              status: "delivered",
              delivered_at: { gte: start, lt: end },
            },
          }),
          prisma.parcels.count({
            where: {
              ...parcelWhere,
              order_type: "return",
              created_at: { gte: start, lt: end },
            },
          }),
        ]),
      ),
    ),
    prisma.parcels.aggregate({
      where: parcelWhere,
      _sum: { cod_amount: true },
    }),
    prisma.parcels.aggregate({
      where: { ...parcelWhere, status: { in: PICKUP_PENDING_STATUSES } },
      _sum: { cod_amount: true },
    }),
    prisma.parcels.aggregate({
      where: { ...parcelWhere, order_type: "return", status: { in: OPEN_STATUSES } },
      _sum: { cod_amount: true },
    }),
    prisma.parcels.aggregate({
      where: { ...parcelWhere, status: { in: IN_TRANSIT_STATUSES } },
      _sum: { cod_amount: true },
    }),
    prisma.parcels.aggregate({
      where: { ...parcelWhere, status: "delivered" },
      _sum: { cod_amount: true },
    }),
    prisma.parcels.aggregate({
      where: { ...parcelWhere, order_type: "return" },
      _sum: { cod_amount: true },
    }),
  ]);

  const totalOrderAmount = moneyToNumber(orderAmountTotals._sum.cod_amount);
  const pendingPickupsAmount = moneyToNumber(pendingPickupsAmountTotals._sum.cod_amount);
  const pendingReturnsAmount = moneyToNumber(pendingReturnsAmountTotals._sum.cod_amount);
  const inTransitAmount = moneyToNumber(inTransitAmountTotals._sum.cod_amount);
  const totalDeliveredAmount = moneyToNumber(deliveredAmountTotals._sum.cod_amount);
  const totalReturnsAmount = moneyToNumber(returnsAmountTotals._sum.cod_amount);
  const totalCod = moneyToNumber(codTotals._sum.cod_amount);
  const settledCod = moneyToNumber(codTotals._sum.remitted_amount);
  const pendingCod = codTotals._sum.pending_amount === null
    ? Math.max(totalCod - settledCod, 0)
    : moneyToNumber(codTotals._sum.pending_amount);

  const weeklyTrend = trendDayRanges.map(({ start }, index) => {
    const [delivered, returned] = trendCounts[index] ?? [0, 0];
    return {
      day: start.toLocaleDateString("en-US", { weekday: "short" }),
      date: formatDate(start),
      delivered,
      returned,
    };
  });

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

async function notifyVendorOfStatusChange(
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
  // validate role-based permissions of certain transtions
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  const isVendorActor = actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
  const isRiderActor = actor.roles.includes("rider");

  // Non-admin actors may only update parcels that belong to them: a vendor's
  // own orders, or a rider's own pickup/delivery leg. Without this, any
  // vendor/rider could transition any parcel in the system.
  const { vendorId, riderId } = isVendorActor || isRiderActor
    ? await getActorScope(actor)
    : { vendorId: undefined, riderId: undefined };

  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(riderId ? { OR: [{ pickup_rider_id: riderId }, { delivery_rider_id: riderId }] } : {}),
    },
    include: {
      pickup_tasks: true,
    },
  });

  if (!parcel) {
    throw new AppError(404, "Parcel not found or does not belong to your account");
  }

  const currentStatus = parcel.status as ParcelStatus;
  const newStatus = data.status;

  // cannot transition from a terminal state
  if (TERMINAL_STATUSES.includes(currentStatus as parcel_status)) {
    throw new AppError(
      409,
      `Cannot update status: parcel id already '${currentStatus}' (terminal state)`,
    );
  }

  // validate the transition is allowed
  const allowed = STATUS_TRANSITIONS[
    currentStatus as keyof typeof STATUS_TRANSITIONS
  ] as readonly ParcelStatus[];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new AppError(
      422,
      `Invalid status transition: '${currentStatus}' → '${newStatus}'. Allowed: [${allowed?.join(", ")}]`,
    );
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

  if (data.locationId) {
    const loc = await prisma.locations.findUnique({
      where: { id: data.locationId },
    });
    if (!loc || !loc.is_active) {
      throw new AppError(400, "Location not found or inactive");
    }
  }

  // rider_assigned needs a pickup rider, sent_for_delivery needs a delivery rider
  const riderAssignmentField = RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status];
  if (riderAssignmentField) {
    if (!data.riderId) {
      throw new AppError(400, `riderId is required to transition to '${newStatus}'`);
    }
    await resolveActiveRider(data.riderId);
  }

  const updatedParcel = await prisma.$transaction(async (tx) => {
    const updateData: Prisma.parcelsUpdateInput = {
      status: newStatus as parcel_status,
    };
    // Side-effect: set delivered_at timestamp
    if (newStatus === "delivered") {
      (updateData as any).delivered_at = new Date();
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
  const isVendorActor =
    actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
  const isRiderActor = actor.roles.includes("rider");

  // Hub operations (dispatch, OOV transitions) are admin-only.
  if (HUB_OPERATION_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can perform dispatch hub operations");
  }
  // The return-to-origin workflow is staff-only.
  if (RETURN_WORKFLOW_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can manage the return workflow");
  }
  // Cancellation is allowed for admins and vendors (vendors may only cancel their own orders,
  // enforced by the vendor_id scope below).
  if (newStatus === "cancelled" && !isAdmin && !isVendorActor) {
    throw new AppError(403, "Only vendors or admins can cancel orders");
  }

  // Resolve vendor/rider scope so non-admin actors can only act on their own parcels.
  // (Named actorRiderId to avoid colliding with the dispatch-manifest riderId below,
  // which is a different rider: the one carrying the manifest, not the acting user.)
  const { vendorId, riderId: actorRiderId } = isVendorActor || isRiderActor
    ? await getActorScope(actor)
    : { vendorId: undefined, riderId: undefined };

  const parcels = await prisma.parcels.findMany({
    where: {
      id: { in: ids },
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(actorRiderId
        ? { OR: [{ pickup_rider_id: actorRiderId }, { delivery_rider_id: actorRiderId }] }
        : {}),
    },
    include: { pickup_tasks: true },
  });

  if (parcels.length !== ids.length) {
    throw new AppError(404, "One or more parcels were not found or do not belong to your account");
  }

  for (const parcel of parcels) {
    const currentStatus = parcel.status as ParcelStatus;
    if (TERMINAL_STATUSES.includes(currentStatus as parcel_status)) {
      throw new AppError(
        409,
        `Parcel ${parcel.tracking_id} is already '${currentStatus}' (terminal state)`,
      );
    }
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
  const riderAssignmentField = RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status];
  let parcelRiderId: string | null = null;
  if (riderAssignmentField) {
    if (!data.riderId) {
      throw new AppError(400, `riderId is required to transition to '${newStatus}'`);
    }
    const rider = await resolveActiveRider(data.riderId);
    parcelRiderId = rider.id;
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
