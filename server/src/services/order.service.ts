import { Prisma } from '../generated/prisma/client';
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { CreateOrderInput } from "../types/order.type";
import { generateTrackingId } from "../utils/trackingId";

type OrderActor = {
  id: string;
  roles: string[];
};

const MAX_TRACKING_ID_RETRIES = 5;

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

export async function createOrder(
  actor: OrderActor,
  data: CreateOrderInput,
  idempotencyKey?: string,
) {
  // Optional Idempotency Check (Requires adding idempotency_key to schema first)
  // if (idempotencyKey) {
  //   const existing = await prisma.parcels.findFirst({
  //     where: { idempotency_key: idempotencyKey },
  //   });
  //   if (existing) return existing; 
  // }

  const actorIsVendor = actor.roles.includes("vendor");

  let vendor = null;
  if (actorIsVendor) {
    vendor = await prisma.vendors.findUnique({
      where: { user_id: actor.id, deleted_at: null, status: "active" },
    });
    if (!vendor)
      throw new AppError(403, "Vendor profile not found or inactive");
  } else if (data.vendorId) {
    vendor = await prisma.vendors.findUnique({
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
          scheduled_at: data.scheduledPickupAt ? new Date(data.scheduledPickupAt) : null,
          status: "pickup_ordered",
        },
      }),
    ]);

    await tx.cod_collections.create({
      data: {
        parcel_id: parcel.id,
        vendor_id: vendor?.id || null,
        cod_amount: data.codAmount || 0,
        payment_status: "pending"
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
      }
    });

    return parcel;
  });
}