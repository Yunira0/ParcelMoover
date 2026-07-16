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

export const ZONES = ["major_cities", "urban_areas", "remote_areas", "inside_valley"] as const;
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
  valley: Valley | null; // destination's valley side, for return-rate lookup
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
    zoneInsideValley: settings.zone_inside_valley === null ? null : Number(settings.zone_inside_valley),
    flatInsideValley: settings.flat_inside_valley === null ? null : Number(settings.flat_inside_valley),
    flatOutsideValley: settings.flat_outside_valley === null ? null : Number(settings.flat_outside_valley),
    extraWeightPercent: settings.extra_weight_percent === null ? null : Number(settings.extra_weight_percent),
    freeWeightKg: Number(settings.free_weight_kg),
    branchZoneMajorCities: settings.branch_zone_major_cities === null ? null : Number(settings.branch_zone_major_cities),
    branchZoneUrbanAreas: settings.branch_zone_urban_areas === null ? null : Number(settings.branch_zone_urban_areas),
    branchZoneRemoteAreas: settings.branch_zone_remote_areas === null ? null : Number(settings.branch_zone_remote_areas),
    branchZoneInsideValley: settings.branch_zone_inside_valley === null ? null : Number(settings.branch_zone_inside_valley),
    branchFlatInsideValley: settings.branch_flat_inside_valley === null ? null : Number(settings.branch_flat_inside_valley),
    branchFlatOutsideValley: settings.branch_flat_outside_valley === null ? null : Number(settings.branch_flat_outside_valley),
    returnInsideValleyPercent:
      settings.return_inside_valley_percent === null ? null : Number(settings.return_inside_valley_percent),
    returnOutsideValleyPercent:
      settings.return_outside_valley_percent === null ? null : Number(settings.return_outside_valley_percent),
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
  zoneInsideValley?: number | null;
  flatInsideValley?: number | null;
  flatOutsideValley?: number | null;
  extraWeightPercent?: number | null;
  freeWeightKg?: number;
  branchZoneMajorCities?: number | null;
  branchZoneUrbanAreas?: number | null;
  branchZoneRemoteAreas?: number | null;
  branchZoneInsideValley?: number | null;
  branchFlatInsideValley?: number | null;
  branchFlatOutsideValley?: number | null;
  returnInsideValleyPercent?: number | null;
  returnOutsideValleyPercent?: number | null;
}

export async function updatePricingSettings(input: UpdatePricingSettingsInput) {
  const current = await getPricingSettings();
  await prisma.pricing_settings.update({
    where: { id: current.id },
    data: {
      ...(input.zoneMajorCities !== undefined ? { zone_major_cities: input.zoneMajorCities } : {}),
      ...(input.zoneUrbanAreas !== undefined ? { zone_urban_areas: input.zoneUrbanAreas } : {}),
      ...(input.zoneRemoteAreas !== undefined ? { zone_remote_areas: input.zoneRemoteAreas } : {}),
      ...(input.zoneInsideValley !== undefined ? { zone_inside_valley: input.zoneInsideValley } : {}),
      ...(input.flatInsideValley !== undefined ? { flat_inside_valley: input.flatInsideValley } : {}),
      ...(input.flatOutsideValley !== undefined ? { flat_outside_valley: input.flatOutsideValley } : {}),
      ...(input.extraWeightPercent !== undefined ? { extra_weight_percent: input.extraWeightPercent } : {}),
      ...(input.freeWeightKg !== undefined ? { free_weight_kg: input.freeWeightKg } : {}),
      ...(input.branchZoneMajorCities !== undefined ? { branch_zone_major_cities: input.branchZoneMajorCities } : {}),
      ...(input.branchZoneUrbanAreas !== undefined ? { branch_zone_urban_areas: input.branchZoneUrbanAreas } : {}),
      ...(input.branchZoneRemoteAreas !== undefined ? { branch_zone_remote_areas: input.branchZoneRemoteAreas } : {}),
      ...(input.branchZoneInsideValley !== undefined ? { branch_zone_inside_valley: input.branchZoneInsideValley } : {}),
      ...(input.branchFlatInsideValley !== undefined ? { branch_flat_inside_valley: input.branchFlatInsideValley } : {}),
      ...(input.branchFlatOutsideValley !== undefined ? { branch_flat_outside_valley: input.branchFlatOutsideValley } : {}),
      ...(input.returnInsideValleyPercent !== undefined ? { return_inside_valley_percent: input.returnInsideValleyPercent } : {}),
      ...(input.returnOutsideValleyPercent !== undefined ? { return_outside_valley_percent: input.returnOutsideValleyPercent } : {}),
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
    branchPerDestinationRate:
      dest.branch_per_destination_rate !== null
        ? Number(dest.branch_per_destination_rate)
        : parent?.branch_per_destination_rate != null
        ? Number(parent.branch_per_destination_rate)
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
  zoneInsideValley?: number | null;
  // Cross-model override: when set, inside-valley destinations are charged this
  // flat rate regardless of the vendor's primary rate model.
  insideValleyFlatRate?: number | null;
  extraWeightPercent?: number | null;
  // Parallel branch-delivery overrides (used when service_type = branch_delivery).
  branchFlatInsideValley?: number | null;
  branchFlatOutsideValley?: number | null;
  branchZoneMajorCities?: number | null;
  branchZoneUrbanAreas?: number | null;
  branchZoneRemoteAreas?: number | null;
  branchZoneInsideValley?: number | null;
  // Return-parcel charge as a percent of the normal delivery rate, by valley side.
  returnInsideValleyPercent?: number | null;
  returnOutsideValleyPercent?: number | null;
}

export type ServiceType = "home_delivery" | "branch_delivery";

// Computes the delivery charge for a vendor's chosen rate model to a destination,
// honouring per-vendor overrides before falling back to the global defaults.
export async function getVendorQuote(
  rateType: RateType,
  destinationLocationId: string,
  weightKg = 1,
  overrides: VendorRateOverrides = {},
  serviceType: ServiceType = "home_delivery",
): Promise<DeliveryQuote> {
  const settings = await getPricingSettings();
  const dest = await resolveDestinationPricing(destinationLocationId);

  const pick = (override: number | null | undefined, fallback: number | null) =>
    override !== undefined && override !== null ? override : fallback;

  // Branch deliveries price off the parallel branch rate set. Each branch value
  // falls back to its home counterpart when unset, so a vendor/admin only fills
  // in branch rates where they actually differ.
  const isBranch = serviceType === "branch_delivery";
  const fb = (branch: number | null | undefined, home: number | null) =>
    branch !== undefined && branch !== null ? branch : home;
  const sFlatInside = isBranch ? fb(settings.branchFlatInsideValley, settings.flatInsideValley) : settings.flatInsideValley;
  const sFlatOutside = isBranch ? fb(settings.branchFlatOutsideValley, settings.flatOutsideValley) : settings.flatOutsideValley;
  const sZoneMajor = isBranch ? fb(settings.branchZoneMajorCities, settings.zoneMajorCities) : settings.zoneMajorCities;
  const sZoneUrban = isBranch ? fb(settings.branchZoneUrbanAreas, settings.zoneUrbanAreas) : settings.zoneUrbanAreas;
  const sZoneRemote = isBranch ? fb(settings.branchZoneRemoteAreas, settings.zoneRemoteAreas) : settings.zoneRemoteAreas;
  const sZoneInside = isBranch ? fb(settings.branchZoneInsideValley, settings.zoneInsideValley) : settings.zoneInsideValley;
  const oFlatInside = isBranch ? overrides.branchFlatInsideValley : overrides.flatInsideValley;
  const oFlatOutside = isBranch ? overrides.branchFlatOutsideValley : overrides.flatOutsideValley;
  const oZoneMajor = isBranch ? overrides.branchZoneMajorCities : overrides.zoneMajorCities;
  const oZoneUrban = isBranch ? overrides.branchZoneUrbanAreas : overrides.zoneUrbanAreas;
  const oZoneRemote = isBranch ? overrides.branchZoneRemoteAreas : overrides.zoneRemoteAreas;
  const oZoneInside = isBranch ? overrides.branchZoneInsideValley : overrides.zoneInsideValley;
  const perDestRate = isBranch ? fb(dest.branchPerDestinationRate, dest.perDestinationRate) : dest.perDestinationRate;
  const label = isBranch ? "branch" : "home";

  let rate: number | null = null;
  let basis = "";

  // Cross-model override (home only): a vendor may pair their primary model with
  // a flat rate for inside-valley deliveries.
  if (!isBranch && dest.valley === "inside" && overrides.insideValleyFlatRate != null) {
    rate = overrides.insideValleyFlatRate;
    basis = "Flat inside-valley rate";
  } else if (rateType === "per_destination") {
    rate = perDestRate;
    basis = `Per-destination ${label} rate for ${dest.name}`;
    if (rate === null) throw new AppError(404, `No per-destination ${label} rate set for ${dest.name}`);
  } else if (rateType === "zone") {
    if (!dest.zone) throw new AppError(404, `${dest.name} is not assigned to a zone`);
    rate =
      dest.zone === "major_cities"
        ? pick(oZoneMajor, sZoneMajor)
        : dest.zone === "urban_areas"
        ? pick(oZoneUrban, sZoneUrban)
        : dest.zone === "inside_valley"
        ? pick(oZoneInside, sZoneInside)
        : pick(oZoneRemote, sZoneRemote);
    basis = `Zone ${label} rate (${dest.zone.replace("_", " ")})`;
    if (rate === null) throw new AppError(404, `No ${label} rate set for zone "${dest.zone}"`);
  } else {
    if (!dest.valley) throw new AppError(404, `${dest.name} is not classified inside/outside valley`);
    rate =
      dest.valley === "inside"
        ? pick(oFlatInside, sFlatInside)
        : pick(oFlatOutside, sFlatOutside);
    basis = `Flat ${label} rate (${dest.valley} valley)`;
    if (rate === null) throw new AppError(404, `No flat ${label} rate set for ${dest.valley} valley`);
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
    valley: dest.valley,
  };
}

// A return parcel is charged a percent of what a normal delivery to the same
// destination would cost, chosen by the destination's valley side (e.g. 0%
// inside valley, 50% outside). Per-vendor return percents win over the global
// pricing_settings defaults; an unset/unknown percent means a free return (0%).
export async function getReturnDeliveryQuote(
  rateType: RateType,
  destinationLocationId: string,
  weightKg = 1,
  overrides: VendorRateOverrides = {},
  serviceType: ServiceType = "home_delivery",
): Promise<DeliveryQuote & { returnPercent: number; baseDeliveryCharge: number }> {
  const base = await getVendorQuote(rateType, destinationLocationId, weightKg, overrides, serviceType);
  const settings = await getPricingSettings();

  const pick = (override: number | null | undefined, fallback: number | null) =>
    override !== undefined && override !== null ? override : fallback;

  const percent =
    (base.valley === "inside"
      ? pick(overrides.returnInsideValleyPercent, settings.returnInsideValleyPercent)
      : base.valley === "outside"
      ? pick(overrides.returnOutsideValleyPercent, settings.returnOutsideValleyPercent)
      : null) ?? 0;

  const charge = base.totalPayable * (percent / 100);
  const valleyLabel = base.valley ? `${base.valley} valley` : "unclassified destination";

  return {
    ...base,
    baseCharge: charge,
    weightSurcharge: 0,
    totalPayable: charge,
    basis: `Return rate (${percent}% of delivery, ${valleyLabel})`,
    returnPercent: percent,
    baseDeliveryCharge: base.totalPayable,
  };
}
