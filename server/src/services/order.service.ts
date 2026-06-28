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
  ParcelStatus,
  STATUS_TRANSITIONS,
  UpdateParcelStatusInput,
} from "../types/order.type";
import { generateTrackingId } from "../utils/trackingId";
import { generateDispatchNo } from "../utils/dispatchId";

type Party = { name: string; phone: string; alternate_phone?: string | null };
function buildSearchText(trackingId: string, sender: Party, receiver: Party): string {
  return [
    trackingId,
    sender.name, sender.phone, sender.alternate_phone ?? "",
    receiver.name, receiver.phone, receiver.alternate_phone ?? "",
  ].join(" ").toLowerCase();
}
import { getDeliveryQuote } from "./delivery-rate.service";
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

// Hub-level transitions: building/closing a dispatch manifest is a branch
// operation, not something a delivery rider should be able to trigger.
const HUB_OPERATION_STATUSES: parcel_status[] = ["dispatched", "arrived_at_branch"];

const TERMINAL_STATUSES: parcel_status[] = [
  "delivered",
  "failed_pickup",
  "failed_delivery",
  "cancelled",
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

// Which parcel column a rider gets written to, depending on the leg they're being assigned for.
const RIDER_ASSIGNMENT_FIELD: Partial<Record<parcel_status, "pickup_rider_id" | "delivery_rider_id">> = {
  rider_assigned: "pickup_rider_id",
  sent_for_delivery: "delivery_rider_id",
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

const formatDate = (date?: Date | null) => date ? date.toISOString().slice(0, 10) : "";

const moneyToNumber = (value?: Prisma.Decimal | null) => value ? Number(value) : 0;

async function getActorScope(actor: OrderActor) {
  const actorIsVendor = actor.roles.includes("vendor");
  const actorIsRider = actor.roles.includes("rider");
  const actorIsVendorStaff = actor.roles.includes("vendor_staff");

  // Vendor staff: resolve vendor via their staff record, not the vendors table.
  if (actorIsVendorStaff) {
    const staffRecord = await prisma.vendor_staff.findFirst({
      where: { user_id: actor.id, deleted_at: null, enabled: true },
      select: { vendor_id: true },
    });
    if (!staffRecord) throw new AppError(403, "Staff profile not found or inactive");
    return { vendorId: staffRecord.vendor_id, riderId: undefined };
  }

  const [vendor, rider] = await Promise.all([
    actorIsVendor
      ? prisma.vendors.findFirst({
          where: { user_id: actor.id, deleted_at: null, status: "active" },
          select: { id: true },
        })
      : Promise.resolve(null),
    actorIsRider
      ? prisma.riders.findFirst({
          where: { user_id: actor.id, deleted_at: null, status: "active" },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (actorIsVendor && !vendor) {
    throw new AppError(403, "Vendor profile not found or inactive");
  }

  if (actorIsRider && !rider) {
    throw new AppError(403, "Rider profile not found or inactive");
  }

  return { vendorId: vendor?.id, riderId: rider?.id };
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
  return parcel;
}

async function _createOrderImpl(actor: OrderActor, data: CreateOrderInput) {
  const actorIsVendor = actor.roles.includes("vendor");

  // Run all three independent reads in parallel instead of sequentially.
  const [vendor, originLoc, destinationLoc] = await Promise.all([
    actorIsVendor
      ? prisma.vendors.findFirst({
          where: { user_id: actor.id, deleted_at: null, status: "active" },
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

  if (actorIsVendor && !vendor) throw new AppError(403, "Vendor profile not found or inactive");
  if (!actorIsVendor && data.vendorId && !vendor) throw new AppError(404, "Vendor not found or inactive");
  if (data.originLocationId && (!originLoc || !originLoc.is_active))
    throw new AppError(400, "Origin location not found or inactive");
  if (data.destinationLocationId && (!destinationLoc || !destinationLoc.is_active))
    throw new AppError(400, "Destination location not found or inactive");

  const resolvedOriginLocationId = data.originLocationId || data.sender.locationId || null;
  const resolvedDestinationLocationId = data.destinationLocationId || data.receiver.locationId || null;
  const weightKg = data.weightKg || 1;

  // Payable is computed server-side from the route's configured rate so the
  // client can't spoof the charge. Falls back to a manually supplied charge
  // only when a route can't be resolved (e.g. legacy callers without locations).
  let deliveryCharge = data.deliveryCharge || 0;
  if (resolvedOriginLocationId && resolvedDestinationLocationId) {
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
  > = [];

  for (let i = 0; i < input.orders.length; i++) {
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
    } catch (err: any) {
      results.push({ index: i, success: false, error: err.message || "Order creation failed" });
      failed++;
    }
  }

  // Flush caches once for the whole batch instead of after each individual order.
  if (created > 0) await invalidateOrderCaches();

  return { created, failed, results };
}

function buildOrdersWhere(
  scope: { vendorId: string | undefined; riderId: string | undefined },
  query: ListOrdersQuery,
): Prisma.parcelsWhereInput {
  const conditions: Prisma.parcelsWhereInput[] = [{ deleted_at: null }];

  if (scope.vendorId) {
    conditions.push({ vendor_id: scope.vendorId });
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

export async function listOrders(
  actor: OrderActor,
  query: ListOrdersQuery = {},
): Promise<ListOrdersResult> {
  const { vendorId, riderId } = await getActorScope(actor);
  const where = buildOrdersWhere({ vendorId, riderId }, query);

  // Pagination only kicks in when the caller explicitly asks for it, so
  // existing callers that expect a flat array keep working unchanged.
  const paginated = query.page !== undefined || query.pageSize !== undefined;

  // Most pages (OrderManagement, DispatchOperations, PickupOperations, ...)
  // call listOrders() with no filters at all and reload on every status-change
  // event - that's the only shape worth caching, since filtered/paginated
  // queries have too many distinct combinations to get useful hit rates.
  const isDefaultUnfilteredQuery = !paginated && !query.status?.length && !query.orderType && !query.search;
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
    const parcels = await prisma.parcels.findMany({
      where,
      include: ORDERS_INCLUDE,
      orderBy: { created_at: "desc" },
      take: 200,
    });
    const result: ListOrdersResult = { data: parcels.map(mapOrder) };

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
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: parcels.map(mapOrder),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
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
  const { vendorId, riderId } = await getActorScope(actor);
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");

  const parcel = await prisma.parcels.findFirst({
    where: {
      tracking_id: trackingId,
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
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

  const { vendorId, riderId } = await getActorScope(actor);

  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
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
  const { vendorId, riderId } = await getActorScope(actor);
  const cacheKey = dashboardSummaryCacheKey(vendorId, riderId);

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error("[Redis] Failed to read dashboard summary cache:", error);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const parcelWhere: Prisma.parcelsWhereInput = {
    deleted_at: null,
    ...(vendorId ? { vendor_id: vendorId } : {}),
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
    ...(riderId ? { rider_id: riderId } : {}),
  };

  const settlementWhere: Prisma.settlementsWhereInput = {
    status: "settled",
    ...(vendorId ? { vendor_id: vendorId } : {}),
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
    totalReturns,
    todaysOrders,
    todaysDelivered,
    todaysReturns,
    todaysRemarks,
    unclosedComments,
    codTotals,
    lastSettlement,
    trendCounts,
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
  ]);

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
      pendingPickups,
      pendingReturns,
      inTransit,
      pendingDeliveries,
      totalDelivered,
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

  try {
    await redis.setex(cacheKey, DASHBOARD_SUMMARY_TTL_SECONDS, JSON.stringify(summary));
  } catch (error) {
    console.error("[Redis] Failed to write dashboard summary cache:", error);
  }

  return summary;
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
  );
}

export async function updateParcelStatus(
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

  // validate role-based permissions of certain transtions
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));

  //only admin aan cancel
  if (newStatus === "cancelled" && !isAdmin) {
    throw new AppError(403, "Only admins can cancel an order");
  }

  // building/closing a dispatch manifest is a branch operation
  if (HUB_OPERATION_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can perform dispatch hub operations");
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

  const newStatus = data.status;
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  const isVendorActor =
    actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");

  // Hub operations (dispatch, OOV transitions) are admin-only.
  if (HUB_OPERATION_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can perform dispatch hub operations");
  }
  // Cancellation is allowed for admins and vendors (vendors may only cancel their own orders,
  // enforced by the vendor_id scope below).
  if (newStatus === "cancelled" && !isAdmin && !isVendorActor) {
    throw new AppError(403, "Only vendors or admins can cancel orders");
  }

  // Resolve vendor scope so vendors can only act on their own parcels.
  const { vendorId } = isVendorActor
    ? await getActorScope(actor)
    : { vendorId: undefined };

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
    if (!data.toLocationId) {
      throw new AppError(400, "toLocationId is required to dispatch a manifest");
    }

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

    // Close out manifests once none of their parcels are still "dispatched"
    if (newStatus === "arrived_at_branch") {
      const links = await tx.dispatch_parcels.findMany({
        where: { parcel_id: { in: ids } },
        select: { dispatch_id: true },
        distinct: ["dispatch_id"],
      });

      for (const link of links) {
        const remainingInTransit = await tx.dispatch_parcels.count({
          where: { dispatch_id: link.dispatch_id, parcels: { status: "dispatched" } },
        });
        if (remainingInTransit === 0) {
          await tx.dispatches.updateMany({
            where: { id: link.dispatch_id, arrived_at: null },
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
        );
      }),
    );
  }

  return result;
}
