import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { DeliveryQuote, UpsertDeliveryRateInput } from "../types/delivery-rate.type";

type Actor = { id: string; roles: string[] };

async function assertActiveLocation(locationId: string, label: string) {
  const loc = await prisma.locations.findUnique({ where: { id: locationId } });
  if (!loc || !loc.is_active) {
    throw new AppError(400, `${label} location not found or inactive`);
  }
  return loc;
}

export async function upsertDeliveryRate(actor: Actor, input: UpsertDeliveryRateInput) {
  if (input.originLocationId === input.destinationLocationId) {
    throw new AppError(400, "Origin and destination locations must be different");
  }
  if (!(input.baseCharge >= 0)) {
    throw new AppError(400, "Base charge must be a non-negative number");
  }

  await Promise.all([
    assertActiveLocation(input.originLocationId, "Origin"),
    assertActiveLocation(input.destinationLocationId, "Destination"),
  ]);

  const data = {
    base_charge: input.baseCharge,
    extra_weight_percent: input.extraWeightPercent ?? 0,
    free_weight_kg: input.freeWeightKg ?? 2,
    is_active: true,
  };

  return prisma.delivery_rates.upsert({
    where: {
      origin_location_id_destination_location_id: {
        origin_location_id: input.originLocationId,
        destination_location_id: input.destinationLocationId,
      },
    },
    update: data,
    create: {
      ...data,
      origin_location_id: input.originLocationId,
      destination_location_id: input.destinationLocationId,
      created_by: actor.id,
    },
  });
}

export async function listDeliveryRates() {
  const rates = await prisma.delivery_rates.findMany({
    include: {
      locations_delivery_rates_origin_location_idTolocations: true,
      locations_delivery_rates_destination_location_idTolocations: true,
    },
    orderBy: { created_at: "desc" },
  });

  return rates.map((rate) => ({
    id: rate.id,
    originLocationId: rate.origin_location_id,
    originLocationName: rate.locations_delivery_rates_origin_location_idTolocations.name,
    destinationLocationId: rate.destination_location_id,
    destinationLocationName: rate.locations_delivery_rates_destination_location_idTolocations.name,
    baseCharge: Number(rate.base_charge),
    extraWeightPercent: Number(rate.extra_weight_percent),
    freeWeightKg: Number(rate.free_weight_kg),
    isActive: rate.is_active,
    createdAt: rate.created_at,
  }));
}

export async function setDeliveryRateActive(id: string, isActive: boolean) {
  const rate = await prisma.delivery_rates.findUnique({ where: { id } });
  if (!rate) {
    throw new AppError(404, "Delivery rate not found");
  }
  return prisma.delivery_rates.update({ where: { id }, data: { is_active: isActive } });
}

export async function getDeliveryQuote(
  originLocationId: string,
  destinationLocationId: string,
  weightKg: number,
): Promise<DeliveryQuote> {
  const rate = await prisma.delivery_rates.findFirst({
    where: {
      origin_location_id: originLocationId,
      destination_location_id: destinationLocationId,
      is_active: true,
    },
  });

  if (!rate) {
    throw new AppError(404, "No delivery rate configured for this route");
  }

  const baseCharge = Number(rate.base_charge);
  const freeWeightKg = Number(rate.free_weight_kg);
  const extraWeightPercent = Number(rate.extra_weight_percent);

  const extraKg = Math.max(0, weightKg - freeWeightKg);
  const weightSurcharge = extraKg * (baseCharge * (extraWeightPercent / 100));
  const totalPayable = baseCharge + weightSurcharge;

  return { baseCharge, weightSurcharge, totalPayable, freeWeightKg, extraWeightPercent };
}
