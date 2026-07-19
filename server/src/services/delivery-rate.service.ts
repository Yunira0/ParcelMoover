import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { AppError } from "../utils/AppError";
import { DeliveryQuote, UpsertDeliveryRateInput } from "../types/delivery-rate.type";
import {
  getVendorQuote,
  getPricingSettings,
  RateType,
  VendorRateOverrides,
} from "./pricing.service";

type Actor = { id: string; roles: string[] };

const RATE_CACHE_PREFIX = "delivery-rate:";
const RATE_CACHE_TTL_SECONDS = 5 * 60;

interface CachedRate {
  baseCharge: number;
  branchBaseCharge: number | null;
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
    branch_base_charge: input.branchBaseCharge ?? null,
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
    branchBaseCharge: rate.branch_base_charge === null ? null : Number(rate.branch_base_charge),
    extraWeightPercent: Number(rate.extra_weight_percent),
    freeWeightKg: Number(rate.free_weight_kg),
    isActive: rate.is_active,
    createdAt: rate.created_at,
  }));
}

export interface BulkImportRateRow {
  origin: string;
  destination: string;
  baseCharge: number;
  extraWeightPercent?: number;
  freeWeightKg?: number;
}

export interface BulkImportRateResult {
  origin: string;
  destination: string;
  action?: "created" | "updated";
  error?: string;
}

// Spreadsheet rows reference destinations by name; resolve them against the
// hub (top-level) locations once, then upsert row by row so one bad row
// doesn't sink the rest of the file.
export async function bulkImportDeliveryRates(
  actor: Actor,
  rows: BulkImportRateRow[],
): Promise<BulkImportRateResult[]> {
  const hubs = await prisma.locations.findMany({
    where: { parent_id: null, is_active: true },
    select: { id: true, name: true, code: true },
  });
  const hubByKey = new Map<string, { id: string; name: string }>();
  for (const hub of hubs) {
    hubByKey.set(hub.name.trim().toLowerCase(), hub);
    if (hub.code) hubByKey.set(hub.code.trim().toLowerCase(), hub);
  }

  const results: BulkImportRateResult[] = [];

  for (const row of rows) {
    const originHub = hubByKey.get(row.origin.trim().toLowerCase());
    const destinationHub = hubByKey.get(row.destination.trim().toLowerCase());

    const errors: string[] = [];
    if (!originHub) errors.push(`origin '${row.origin}' does not match any active destination`);
    if (!destinationHub) {
      errors.push(`destination '${row.destination}' does not match any active destination`);
    }
    if (originHub && destinationHub && originHub.id === destinationHub.id) {
      errors.push("origin and destination must be different");
    }
    if (!(row.baseCharge >= 0)) errors.push("baseCharge must be a non-negative number");

    if (errors.length) {
      results.push({ origin: row.origin, destination: row.destination, error: errors.join("; ") });
      continue;
    }

    try {
      const existing = await prisma.delivery_rates.findUnique({
        where: {
          origin_location_id_destination_location_id: {
            origin_location_id: originHub!.id,
            destination_location_id: destinationHub!.id,
          },
        },
        select: { id: true },
      });

      const data = {
        base_charge: row.baseCharge,
        extra_weight_percent: row.extraWeightPercent ?? 0,
        free_weight_kg: row.freeWeightKg ?? 2,
        is_active: true,
      };

      await prisma.delivery_rates.upsert({
        where: {
          origin_location_id_destination_location_id: {
            origin_location_id: originHub!.id,
            destination_location_id: destinationHub!.id,
          },
        },
        update: data,
        create: {
          ...data,
          origin_location_id: originHub!.id,
          destination_location_id: destinationHub!.id,
          created_by: actor.id,
        },
      });

      await invalidateRateCache(originHub!.id, destinationHub!.id);

      results.push({
        origin: originHub!.name,
        destination: destinationHub!.name,
        action: existing ? "updated" : "created",
      });
    } catch (error: any) {
      results.push({
        origin: row.origin,
        destination: row.destination,
        error: error?.message || "Failed to save rate",
      });
    }
  }

  return results;
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
    branchBaseCharge: rate.branch_base_charge === null ? null : Number(rate.branch_base_charge),
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
  serviceType: "home_delivery" | "branch_delivery" = "home_delivery",
): Promise<DeliveryQuote> {
  const rate = await getActiveRate(originLocationId, destinationLocationId);
  const { branchBaseCharge, freeWeightKg, extraWeightPercent } = rate;
  // Branch deliveries use the branch base charge when configured, else the home one.
  const baseCharge =
    serviceType === "branch_delivery" && branchBaseCharge !== null ? branchBaseCharge : rate.baseCharge;

  const extraKg = Math.max(0, weightKg - freeWeightKg);
  const weightSurcharge = extraKg * (baseCharge * (extraWeightPercent / 100));
  const totalPayable = baseCharge + weightSurcharge;

  return { baseCharge, weightSurcharge, totalPayable, freeWeightKg, extraWeightPercent };
}

// Resolve the vendor behind the current actor - either the owner (users -> vendors)
// or a staff member (users -> vendor_staff -> vendors).
async function resolveActorVendor(actor: Actor) {
  let vendor = await prisma.vendors.findFirst({
    where: { user_id: actor.id, deleted_at: null },
  });
  if (!vendor) {
    const staff = await prisma.vendor_staff.findFirst({
      where: { user_id: actor.id, deleted_at: null, enabled: true },
      select: { vendor_id: true },
    });
    if (staff) {
      vendor = await prisma.vendors.findFirst({
        where: { id: staff.vendor_id, deleted_at: null },
      });
    }
  }
  return vendor;
}

function buildVendorOverrides(vendor: NonNullable<Awaited<ReturnType<typeof resolveActorVendor>>>): VendorRateOverrides {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    flatInsideValley: n(vendor.flat_inside_valley),
    flatOutsideValley: n(vendor.flat_outside_valley),
    zoneMajorCities: n(vendor.zone_major_cities),
    zoneUrbanAreas: n(vendor.zone_urban_areas),
    zoneRemoteAreas: n(vendor.zone_remote_areas),
    zoneInsideValley: n(vendor.zone_inside_valley),
    insideValleyFlatRate: n(vendor.inside_valley_flat_rate),
    extraWeightPercent: n(vendor.extra_weight_percent),
    branchFlatInsideValley: n(vendor.branch_flat_inside_valley),
    branchFlatOutsideValley: n(vendor.branch_flat_outside_valley),
    branchZoneMajorCities: n(vendor.branch_zone_major_cities),
    branchZoneUrbanAreas: n(vendor.branch_zone_urban_areas),
    branchZoneRemoteAreas: n(vendor.branch_zone_remote_areas),
    branchZoneInsideValley: n(vendor.branch_zone_inside_valley),
  };
}

// The delivery rate that actually applies to THIS vendor, per destination, based
// on their own rate model (flat by valley / zone / per-destination) - not the
// generic admin origin->destination route table. A flat-rate vendor therefore
// sees the same rate for every destination in a valley band, a zone-rate vendor
// sees their zone rate, and a per-destination vendor sees each destination's rate.
export async function getVendorSelfRates(actor: Actor) {
  const vendor = await resolveActorVendor(actor);
  if (!vendor) throw new AppError(404, "No vendor profile found for this account");

  const settings = await getPricingSettings();
  const overrides = buildVendorOverrides(vendor);
  const rateType = (vendor.rate_type as RateType) ?? "flat";

  // Destinations are top-level, active locations (covered areas price off their parent).
  const destinations = await prisma.locations.findMany({
    where: { parent_id: null, is_active: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    destinations.map(async (dest) => {
      // weightKg <= free weight so no surcharge - baseCharge is the pure rate.
      let homeRate: number | null = null;
      let branchRate: number | null = null;
      let note: string | null = null;
      try {
        homeRate = (await getVendorQuote(rateType, dest.id, 1, overrides, "home_delivery")).baseCharge;
      } catch (err) {
        note = err instanceof AppError ? err.message : "Rate not configured";
      }
      try {
        branchRate = (await getVendorQuote(rateType, dest.id, 1, overrides, "branch_delivery")).baseCharge;
      } catch {
        // Branch rate optional; leave null if unset.
      }
      return {
        destinationId: dest.id,
        destinationName: dest.name,
        zone: dest.zone,
        valley: dest.valley,
        homeRate,
        branchRate,
        note,
      };
    }),
  );

  const extraWeightPercent =
    overrides.extraWeightPercent != null ? overrides.extraWeightPercent : settings.extraWeightPercent ?? 0;

  return {
    rateType,
    freeWeightKg: settings.freeWeightKg,
    extraWeightPercent,
    rates: rows,
  };
}
