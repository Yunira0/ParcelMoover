import { parcel_status, Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import {
  CreateOrderInput,
  ParcelStatus,
  STATUS_TRANSITIONS,
  UpdateParcelStatusInput,
} from "../types/order.type";
import { generateTrackingId } from "../utils/trackingId";

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
      email: partyData.email?.trim() || null,
      address: partyData.address?.trim() || null,
    },
  });
}

export async function createOrder(actor: OrderActor, data: CreateOrderInput) {
  //check idempotency key

  const actorIsVendor = actor.roles.includes("vendor");

  let vendor = null;
  if (actorIsVendor) {
    vendor = await prisma.vendors.findFirst({
      where: { user_id: actor.id, deleted_at: null, status: "active" },
    });
    if (!vendor)
      throw new AppError(403, "Vendor profile not found or inactive");
  } else if (data.vendorId) {
    vendor = await prisma.vendors.findFirst({
      where: { id: data.vendorId, deleted_at: null, status: "active" },
    });
    if (!vendor) throw new AppError(404, "Vendor not found or inactive");
  }

  if (data.originLocationId) {
    const loc = await prisma.locations.findUnique({
      where: { id: data.originLocationId },
    });
    if (!loc || !loc.is_active) {
      throw new AppError(400, "Origin location not found or inactive");
    }
  }

  if (data.destinationLocationId) {
    const loc = await prisma.locations.findUnique({
      where: { id: data.destinationLocationId },
    });
    if (!loc || !loc.is_active) {
      throw new AppError(400, "Destination location not found or inactive");
    }
  }

  return prisma.$transaction(async (tx) => {
    const trackingId = await generateUniqueTrackingId(tx);

    const [sender, receiver] = await Promise.all([
      findOrCreateParty(tx, data.sender),
      findOrCreateParty(tx, data.receiver),
    ]);

    const parcel = await tx.parcels.create({
      data: {
        tracking_id: trackingId,
        vendor_id: vendor?.id || null,
        sender_id: sender.id,
        receiver_id: receiver.id,
        origin_location_id:
          data.originLocationId || data.sender.locationId || null,
        current_location_id:
          data.originLocationId || data.sender.locationId || null,
        destination_location_id:
          data.destinationLocationId || data.receiver.locationId || null,
        order_type: data.orderType || "delivery",
        service_type: data.serviceType || "dtd",
        status: "pickup_ordered",
        pieces: data.pieces || 1,
        weight_kg: data.weightKg || 1,
        cod_amount: data.codAmount || 0,
        delivery_charge: data.deliveryCharge || 0,
        created_by: actor.id,
      },
    });

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
          scheduled_at: data.scheduledPickupAt
            ? new Date(data.scheduledPickupAt)
            : null,
          status: "pickup_ordered",
        },
      }),
    ]);

    await tx.cod_collections.create({
      data: {
        parcel_id: parcel.id,
        vendor_id: vendor?.id || null,
        cod_amount: data.codAmount || 0,
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

    return parcel;
  });
}

export async function listOrders(actor: OrderActor) {
  const { vendorId, riderId } = await getActorScope(actor);

  const parcels = await prisma.parcels.findMany({
    where: {
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
    },
    include: {
      parties_parcels_sender_idToparties: true,
      parties_parcels_receiver_idToparties: true,
      locations_parcels_origin_location_idTolocations: true,
      locations_parcels_destination_location_idTolocations: true,
      vendors: true,
      riders_parcels_pickup_rider_idToriders: true,
      riders_parcels_delivery_rider_idToriders: true,
      parcel_remarks: {
        orderBy: { created_at: "desc" },
        take: 1,
      },
      parcel_status_history: {
        orderBy: { created_at: "desc" },
        take: 1,
        include: { users: true },
      },
    },
    orderBy: { created_at: "desc" },
    take: 200,
  });

  return parcels.map(parcel => {
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
  });
}

export async function getDashboardSummary(actor: OrderActor) {
  const { vendorId, riderId } = await getActorScope(actor);
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

  const [
    totalOrders,
    pendingPickups,
    pendingReturns,
    inTransit,
    pendingDeliveries,
    todaysOrders,
    todaysDelivered,
    todaysReturns,
    codTotals,
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
    prisma.cod_collections.aggregate({
      where: codWhere,
      _sum: {
        cod_amount: true,
        remitted_amount: true,
        pending_amount: true,
      },
    }),
  ]);

  const totalCod = moneyToNumber(codTotals._sum.cod_amount);
  const settledCod = moneyToNumber(codTotals._sum.remitted_amount);
  const pendingCod = codTotals._sum.pending_amount === null
    ? Math.max(totalCod - settledCod, 0)
    : moneyToNumber(codTotals._sum.pending_amount);

  return {
    overview: {
      totalOrders,
      pendingPickups,
      pendingReturns,
      inTransit,
      pendingDeliveries,
    },
    today: {
      totalOrders: todaysOrders,
      delivered: todaysDelivered,
      inTransit,
      returns: todaysReturns,
    },
    codSettlement: {
      totalCod,
      settledCod,
      pendingCod,
      progressPercent: totalCod > 0 ? (settledCod / totalCod) * 100 : 0,
      scopedToRider: Boolean(riderId),
    },
    updatedAt: new Date().toISOString(),
  };
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
  if (["delivered", "failed_pickup", "failed_delivery", "cancelled"].includes(currentStatus)) {
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

  //rider addignment request just for testing
  if (data.locationId) {
    const loc = await prisma.locations.findUnique({
      where: { id: data.locationId },
    });
    if (!loc || !loc.is_active) {
      throw new AppError(400, "Location not found or inactive");
    }
  }

  return prisma.$transaction(async (tx) => {
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
}
