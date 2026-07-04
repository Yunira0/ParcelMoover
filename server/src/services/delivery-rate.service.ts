import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { AppError } from "../utils/AppError";
import { DeliveryQuote, UpsertDeliveryRateInput } from "../types/delivery-rate.type";

type Actor = { id: string; roles: string[] };

const RATE_CACHE_PREFIX = "delivery-rate:";
const RATE_CACHE_TTL_SECONDS = 5 * 60;

interface CachedRate {
  baseCharge: number;
  freeWeightKg: number;
  extraWeightPercent: number;
}

function rateCacheKey(originLocationId: string, destinationLocationId: string) {
  return `${RATE_CACHE_PREFIX}${originLocationId}:${destinationLocationId}`;
}

// Rate config only changes on admin writes, so a Redis hiccup just means
// falling back to Postgres for this lookup - never block the quote on it.
async function invalidateRateCache(originLocationId: string, destinationLocationId: string) {
  try {
    await redis.del(rateCacheKey(originLocationId, destinationLocationId));
  } catch (error) {
    console.error("[Redis] Failed to invalidate delivery rate cache:", error);
  }
}

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
  if (input.extraWeightPercent !== undefined && !(input.extraWeightPercent >= 0)) {
    throw new AppError(400, "Extra weight percent must be a non-negative number");
  }
  if (input.freeWeightKg !== undefined && !(input.freeWeightKg >= 0)) {
    throw new AppError(400, "Free weight (kg) must be a non-negative number");
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

  const rate = await prisma.delivery_rates.upsert({
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

  await invalidateRateCache(input.originLocationId, input.destinationLocationId);

  return rate;
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
  const updated = await prisma.delivery_rates.update({ where: { id }, data: { is_active: isActive } });
  await invalidateRateCache(rate.origin_location_id, rate.destination_location_id);
  return updated;
}

async function getActiveRate(
  originLocationId: string,
  destinationLocationId: string,
): Promise<CachedRate> {
  const cacheKey = rateCacheKey(originLocationId, destinationLocationId);

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error("[Redis] Failed to read delivery rate cache:", error);
  }

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

  const result: CachedRate = {
    baseCharge: Number(rate.base_charge),
    freeWeightKg: Number(rate.free_weight_kg),
    extraWeightPercent: Number(rate.extra_weight_percent),
  };

  try {
    await redis.setex(cacheKey, RATE_CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch (error) {
    console.error("[Redis] Failed to write delivery rate cache:", error);
  }

  return result;
}

export async function getDeliveryQuote(
  originLocationId: string,
  destinationLocationId: string,
  weightKg: number,
): Promise<DeliveryQuote> {
  const { baseCharge, freeWeightKg, extraWeightPercent } = await getActiveRate(
    originLocationId,
    destinationLocationId,
  );

  const extraKg = Math.max(0, weightKg - freeWeightKg);
  const weightSurcharge = extraKg * (baseCharge * (extraWeightPercent / 100));
  const totalPayable = baseCharge + weightSurcharge;

  return { baseCharge, weightSurcharge, totalPayable, freeWeightKg, extraWeightPercent };
}
