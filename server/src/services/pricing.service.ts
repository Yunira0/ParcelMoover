import prisma from "../lib/prisma";
import redis, { scanAndDelete } from "../lib/redis";
import { AppError } from "../utils/AppError";

// getVendorQuote runs on essentially every vendor order creation - same hot,
// rarely-changes-but-read-constantly shape as the delivery-rate cache, so it
// gets the same treatment: TTL + invalidate-on-write, fail open on Redis errors.
const PRICING_SETTINGS_CACHE_KEY = "pricing:settings";
const PRICING_DEST_CACHE_PREFIX = "pricing:dest:";
const PRICING_CACHE_TTL_SECONDS = 5 * 60;

export async function invalidatePricingSettingsCache() {
  try {
    await redis.del(PRICING_SETTINGS_CACHE_KEY);
  } catch (error) {
    console.error("[Redis] Failed to invalidate pricing settings cache:", error);
  }
}

// Called from location.service.ts writes too (zone/valley/per-destination-rate
// live on the locations table) - a flat prefix scan is simpler and safe here
// since destination pricing config changes rarely and the location count is small.
export async function invalidateDestinationPricingCache() {
  try {
    await scanAndDelete(`${PRICING_DEST_CACHE_PREFIX}*`);
  } catch (error) {
    console.error("[Redis] Failed to invalidate destination pricing cache:", error);
  }
}

export type RateType = "per_destination" | "zone" | "flat";
export const RATE_TYPES: RateType[] = ["per_destination", "zone", "flat"];

export const ZONES = ["major_cities", "urban_areas", "remote_areas"] as const;
export type Zone = (typeof ZONES)[number];

export const VALLEYS = ["inside", "outside"] as const;
export type Valley = (typeof VALLEYS)[number];

export interface DeliveryQuote {
  baseCharge: number;
  weightSurcharge: number;
  totalPayable: number;
  freeWeightKg: number;
  rateType: RateType;
  basis: string; // which rule produced the rate, for display/debug
}

// There is exactly one pricing_settings row; create a blank one on first read.
export async function getPricingSettings() {
  try {
    const cached = await redis.get(PRICING_SETTINGS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.error("[Redis] Failed to read pricing settings cache:", error);
  }

  let settings = await prisma.pricing_settings.findFirst();
  if (!settings) {
    settings = await prisma.pricing_settings.create({ data: {} });
  }
  const result = {
    id: settings.id,
    zoneMajorCities: settings.zone_major_cities === null ? null : Number(settings.zone_major_cities),
    zoneUrbanAreas: settings.zone_urban_areas === null ? null : Number(settings.zone_urban_areas),
    zoneRemoteAreas: settings.zone_remote_areas === null ? null : Number(settings.zone_remote_areas),
    flatInsideValley: settings.flat_inside_valley === null ? null : Number(settings.flat_inside_valley),
    flatOutsideValley: settings.flat_outside_valley === null ? null : Number(settings.flat_outside_valley),
    extraWeightPercent: settings.extra_weight_percent === null ? null : Number(settings.extra_weight_percent),
    freeWeightKg: Number(settings.free_weight_kg),
  };

  try {
    await redis.setex(PRICING_SETTINGS_CACHE_KEY, PRICING_CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch (error) {
    console.error("[Redis] Failed to write pricing settings cache:", error);
  }

  return result;
}

export interface UpdatePricingSettingsInput {
  zoneMajorCities?: number | null;
  zoneUrbanAreas?: number | null;
  zoneRemoteAreas?: number | null;
  flatInsideValley?: number | null;
  flatOutsideValley?: number | null;
  extraWeightPercent?: number | null;
  freeWeightKg?: number;
}

export async function updatePricingSettings(input: UpdatePricingSettingsInput) {
  const current = await getPricingSettings();
  await prisma.pricing_settings.update({
    where: { id: current.id },
    data: {
      ...(input.zoneMajorCities !== undefined ? { zone_major_cities: input.zoneMajorCities } : {}),
      ...(input.zoneUrbanAreas !== undefined ? { zone_urban_areas: input.zoneUrbanAreas } : {}),
      ...(input.zoneRemoteAreas !== undefined ? { zone_remote_areas: input.zoneRemoteAreas } : {}),
      ...(input.flatInsideValley !== undefined ? { flat_inside_valley: input.flatInsideValley } : {}),
      ...(input.flatOutsideValley !== undefined ? { flat_outside_valley: input.flatOutsideValley } : {}),
      ...(input.extraWeightPercent !== undefined ? { extra_weight_percent: input.extraWeightPercent } : {}),
      ...(input.freeWeightKg !== undefined ? { free_weight_kg: input.freeWeightKg } : {}),
      updated_at: new Date(),
    },
  });
  await invalidatePricingSettingsCache();
  return getPricingSettings();
}

// Resolve the destination's effective pricing fields, falling back to its parent
// destination when the order targets a covered area that has none of its own.
async function resolveDestinationPricing(destinationLocationId: string) {
  const cacheKey = `${PRICING_DEST_CACHE_PREFIX}${destinationLocationId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.error("[Redis] Failed to read destination pricing cache:", error);
  }

  const dest = await prisma.locations.findUnique({ where: { id: destinationLocationId } });
  if (!dest) throw new AppError(400, "Destination location not found");

  let parent: typeof dest | null = null;
  if (dest.parent_id) {
    parent = await prisma.locations.findUnique({ where: { id: dest.parent_id } });
  }

  const result = {
    name: dest.name,
    zone: (dest.zone ?? parent?.zone ?? null) as Zone | null,
    valley: (dest.valley ?? parent?.valley ?? null) as Valley | null,
    perDestinationRate:
      dest.per_destination_rate !== null
        ? Number(dest.per_destination_rate)
        : parent?.per_destination_rate != null
        ? Number(parent.per_destination_rate)
        : null,
  };

  try {
    await redis.setex(cacheKey, PRICING_CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch (error) {
    console.error("[Redis] Failed to write destination pricing cache:", error);
  }

  return result;
}

// Per-vendor rate overrides; any null field falls back to the global default.
export interface VendorRateOverrides {
  flatInsideValley?: number | null;
  flatOutsideValley?: number | null;
  zoneMajorCities?: number | null;
  zoneUrbanAreas?: number | null;
  zoneRemoteAreas?: number | null;
  extraWeightPercent?: number | null;
}

// Computes the delivery charge for a vendor's chosen rate model to a destination,
// honouring per-vendor overrides before falling back to the global defaults.
export async function getVendorQuote(
  rateType: RateType,
  destinationLocationId: string,
  weightKg = 1,
  overrides: VendorRateOverrides = {},
): Promise<DeliveryQuote> {
  const settings = await getPricingSettings();
  const dest = await resolveDestinationPricing(destinationLocationId);

  const pick = (override: number | null | undefined, fallback: number | null) =>
    override !== undefined && override !== null ? override : fallback;

  let rate: number | null = null;
  let basis = "";

  if (rateType === "per_destination") {
    rate = dest.perDestinationRate;
    basis = `Per-destination rate for ${dest.name}`;
    if (rate === null) throw new AppError(404, `No per-destination rate set for ${dest.name}`);
  } else if (rateType === "zone") {
    if (!dest.zone) throw new AppError(404, `${dest.name} is not assigned to a zone`);
    rate =
      dest.zone === "major_cities"
        ? pick(overrides.zoneMajorCities, settings.zoneMajorCities)
        : dest.zone === "urban_areas"
        ? pick(overrides.zoneUrbanAreas, settings.zoneUrbanAreas)
        : pick(overrides.zoneRemoteAreas, settings.zoneRemoteAreas);
    basis = `Zone rate (${dest.zone.replace("_", " ")})`;
    if (rate === null) throw new AppError(404, `No rate set for zone "${dest.zone}"`);
  } else {
    if (!dest.valley) throw new AppError(404, `${dest.name} is not classified inside/outside valley`);
    rate =
      dest.valley === "inside"
        ? pick(overrides.flatInsideValley, settings.flatInsideValley)
        : pick(overrides.flatOutsideValley, settings.flatOutsideValley);
    basis = `Flat rate (${dest.valley} valley)`;
    if (rate === null) throw new AppError(404, `No flat rate set for ${dest.valley} valley`);
  }

  // Weight surcharge: extra kg beyond freeWeightKg charged as a percent of the base rate.
  const freeWeightKg = settings.freeWeightKg;
  const extraWeightPercent = pick(overrides.extraWeightPercent, settings.extraWeightPercent) ?? 0;
  const extraKg = Math.max(0, weightKg - freeWeightKg);
  const weightSurcharge = extraKg * (rate * (extraWeightPercent / 100));
  const totalPayable = rate + weightSurcharge;

  return {
    baseCharge: rate,
    weightSurcharge,
    totalPayable,
    freeWeightKg,
    rateType,
    basis,
  };
}
