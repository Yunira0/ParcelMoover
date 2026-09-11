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

/**
 * The hub a branch-scoped admin is limited to as a route's *origin*, or
 * undefined when unrestricted (super_admin, a non-branch-scoped admin, an
 * admin holding BRANCH_TRACKING_READ/WRITE cross-branch visibility, or
 * Imadol - the central hub, which prices routes for the whole network).
 * Mirrors order.service's getAdminBranchScope carve-outs so a branch
 * workspace admin gets the same "own hub only" rule everywhere.
 */
async function getBranchOriginScope(actor: Actor): Promise<string | undefined> {
  if (actor.roles.includes("super_admin") || !actor.roles.includes("admin")) return undefined;
  const admin = await prisma.admins.findFirst({
    where: { user_id: actor.id },
    select: { location_id: true, branch_scoped: true, permissions: true, locations: { select: { code: true } } },
  });
  if (!admin?.branch_scoped || !admin.location_id) return undefined;
  if (admin.permissions.some((p) => p === "BRANCH_TRACKING_READ" || p === "BRANCH_TRACKING_WRITE")) return undefined;
  if (admin.locations?.code?.trim().toUpperCase() === "IMADOL") return undefined;
  return admin.location_id;
}

/**
 * True for any branch-scoped admin (matches the client's isBranchWorkspaceUser),
 * regardless of the BRANCH_TRACKING/Imadol carve-outs above - those decide the
 * *scope* of what such an admin can see once let in, not whether they're let
 * in at all. Used to open up Route Rates management to every branch admin
 * without requiring a separate SETTINGS_ACCESS delegation, since the write
 * paths above already confine them to their own hub as origin.
 */
export async function isBranchScopedAdmin(actor: Actor): Promise<boolean> {
  if (!actor.roles.includes("admin") || actor.roles.includes("super_admin")) return false;
  const admin = await prisma.admins.findFirst({
    where: { user_id: actor.id },
    select: { branch_scoped: true },
  });
  return Boolean(admin?.branch_scoped);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves a vendor-supplied destination reference to a real location id -
// either it's already a location UUID, or it's a hub name/code (e.g.
// "POKHARA", matching what GET /api/v1/rates lists) that gets looked up
// case-insensitively against active top-level hubs, the same set
// bulkImportDeliveryRates matches Excel rows against. A typo'd hub name
// fails loudly here instead of silently landing on nothing downstream.
export async function resolveDestinationRef(ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (UUID_RE.test(trimmed)) return trimmed;

  const hub = await prisma.locations.findFirst({
    where: {
      parent_id: null,
      is_active: true,
      OR: [
        { name: { equals: trimmed, mode: "insensitive" } },
        { code: { equals: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (!hub) {
    throw new AppError(400, `Unknown destination hub: "${trimmed}". See GET /api/v1/rates for valid names.`, "DESTINATION_NOT_FOUND");
  }
  return hub.id;
}

interface CachedRate {
  baseCharge: number;
  branchBaseCharge: number | null;
  returnPercent: number;
  branchReturnPercent: number | null;
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
  // origin === destination is allowed: it's the local same-hub rate (e.g.
  // Hetauda → Hetauda) used to price a branch's deliveries within its own city.
  const originScope = await getBranchOriginScope(actor);
  if (originScope && input.originLocationId !== originScope) {
    throw new AppError(403, "You can only set delivery rates originating from your own branch");
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
    return_percent: input.returnPercent ?? 0,
    branch_return_percent: input.branchReturnPercent ?? null,
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

export async function listDeliveryRates(actor: Actor) {
  const originScope = await getBranchOriginScope(actor);
  const rates = await prisma.delivery_rates.findMany({
    where: originScope ? { origin_location_id: originScope } : {},
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
    returnPercent: Number(rate.return_percent),
    branchReturnPercent: rate.branch_return_percent === null ? null : Number(rate.branch_return_percent),
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
  branchBaseCharge?: number | null;
  returnPercent?: number;
  branchReturnPercent?: number | null;
  extraWeightPercent?: number;
  freeWeightKg?: number;
}

export interface BulkImportRateResult {
  origin: string;
  destination: string;
  action?: "created" | "updated";
  error?: string;
}

type RowLocation = { id: string; name: string };
type RowLocationResult = RowLocation | { error: string };

function isRowLocationError(result: RowLocationResult): result is { error: string } {
  return "error" in result;
}

// Builds the name/code -> location lookup used to resolve a spreadsheet row's
// free-text origin/destination against a hub OR one of its covered areas.
// Codes are globally unique (locations.code), so a code always resolves
// unambiguously; area *names* are only unique within their own hub (two
// branches can each have a "Chowk" area), so a bare area name that exists
// under more than one hub is rejected with a hint to disambiguate via
// "<hub> / <area>" instead of guessing which one was meant.
async function buildRouteLocationLookup() {
  const locations = await prisma.locations.findMany({
    where: { is_active: true },
    select: { id: true, name: true, code: true, parent_id: true },
  });

  const byCode = new Map<string, RowLocation>();
  const hubById = new Map<string, RowLocation>();
  const byHubNameOrCode = new Map<string, RowLocation>();
  const byComposite = new Map<string, RowLocation>();
  const byAreaName = new Map<string, { id: string; name: string; hubName: string }[]>();

  for (const loc of locations) {
    if (loc.code) byCode.set(loc.code.trim().toLowerCase(), { id: loc.id, name: loc.name });
    if (!loc.parent_id) {
      const hub = { id: loc.id, name: loc.name };
      hubById.set(loc.id, hub);
      byHubNameOrCode.set(loc.name.trim().toLowerCase(), hub);
      if (loc.code) byHubNameOrCode.set(loc.code.trim().toLowerCase(), hub);
    }
  }
  for (const loc of locations) {
    if (!loc.parent_id) continue;
    const hub = hubById.get(loc.parent_id);
    if (!hub) continue; // parent hub is inactive or not top-level
    const areaNameKey = loc.name.trim().toLowerCase();
    const area = { id: loc.id, name: loc.name, hubName: hub.name };
    byAreaName.set(areaNameKey, [...(byAreaName.get(areaNameKey) ?? []), area]);
    byComposite.set(`${hub.name.trim().toLowerCase()}::${areaNameKey}`, { id: loc.id, name: loc.name });
  }

  function resolve(ref: string): RowLocationResult {
    const trimmed = ref.trim();
    const lower = trimmed.toLowerCase();

    const byCodeMatch = byCode.get(lower);
    if (byCodeMatch) return byCodeMatch;

    const hubMatch = byHubNameOrCode.get(lower);
    if (hubMatch) return hubMatch;

    // "<hub> / <area>" disambiguates a covered area from a same-named one
    // under a different hub.
    const slashIdx = trimmed.indexOf("/");
    if (slashIdx !== -1) {
      const hubPart = trimmed.slice(0, slashIdx).trim().toLowerCase();
      const areaPart = trimmed.slice(slashIdx + 1).trim().toLowerCase();
      const compositeMatch = byComposite.get(`${hubPart}::${areaPart}`);
      if (compositeMatch) return compositeMatch;
      return { error: `does not match any active destination or covered area ("${trimmed}")` };
    }

    const areaMatches = byAreaName.get(lower);
    const soleMatch = areaMatches?.length === 1 ? areaMatches[0] : undefined;
    if (soleMatch) return soleMatch;
    if (areaMatches && areaMatches.length > 1) {
      return {
        error: `matches a covered area under more than one destination (${areaMatches
          .map((a) => a.hubName)
          .join(", ")}) - use "<destination> / ${trimmed}" or the area's code to disambiguate`,
      };
    }

    return { error: `does not match any active destination or covered area` };
  }

  return resolve;
}

// Spreadsheet rows reference destinations by name (a hub, or a covered area -
// see buildRouteLocationLookup); resolve them once, then upsert row by row so
// one bad row doesn't sink the rest of the file.
export async function bulkImportDeliveryRates(
  actor: Actor,
  rows: BulkImportRateRow[],
): Promise<BulkImportRateResult[]> {
  const resolveLocationRef = await buildRouteLocationLookup();
  const originScope = await getBranchOriginScope(actor);
  const results: BulkImportRateResult[] = [];

  for (const row of rows) {
    const originResult = resolveLocationRef(row.origin);
    const destinationResult = resolveLocationRef(row.destination);

    const errors: string[] = [];
    if (isRowLocationError(originResult)) errors.push(`origin '${row.origin}' ${originResult.error}`);
    if (isRowLocationError(destinationResult)) errors.push(`destination '${row.destination}' ${destinationResult.error}`);
    if (!isRowLocationError(originResult) && originScope && originResult.id !== originScope) {
      errors.push("you can only import rates originating from your own branch");
    }
    // origin === destination is allowed here too (local same-hub rate).
    if (!(row.baseCharge >= 0)) errors.push("baseCharge must be a non-negative number");
    if (row.branchBaseCharge != null && !(row.branchBaseCharge >= 0)) {
      errors.push("branchBaseCharge must be a non-negative number");
    }
    const pctOk = (v: number | null | undefined) => v == null || (v >= 0 && v <= 100);
    if (!pctOk(row.returnPercent)) errors.push("returnPercent must be between 0 and 100");
    if (!pctOk(row.branchReturnPercent)) errors.push("branchReturnPercent must be between 0 and 100");

    if (errors.length || isRowLocationError(originResult) || isRowLocationError(destinationResult)) {
      results.push({ origin: row.origin, destination: row.destination, error: errors.join("; ") });
      continue;
    }

    try {
      const existing = await prisma.delivery_rates.findUnique({
        where: {
          origin_location_id_destination_location_id: {
            origin_location_id: originResult.id,
            destination_location_id: destinationResult.id,
          },
        },
        select: { id: true },
      });

      const data = {
        base_charge: row.baseCharge,
        branch_base_charge: row.branchBaseCharge ?? null,
        return_percent: row.returnPercent ?? 0,
        branch_return_percent: row.branchReturnPercent ?? null,
        extra_weight_percent: row.extraWeightPercent ?? 0,
        free_weight_kg: row.freeWeightKg ?? 2,
        is_active: true,
      };

      await prisma.delivery_rates.upsert({
        where: {
          origin_location_id_destination_location_id: {
            origin_location_id: originResult.id,
            destination_location_id: destinationResult.id,
          },
        },
        update: data,
        create: {
          ...data,
          origin_location_id: originResult.id,
          destination_location_id: destinationResult.id,
          created_by: actor.id,
        },
      });

      await invalidateRateCache(originResult.id, destinationResult.id);

      results.push({
        origin: originResult.name,
        destination: destinationResult.name,
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

export async function setDeliveryRateActive(actor: Actor, id: string, isActive: boolean) {
  const rate = await prisma.delivery_rates.findUnique({ where: { id } });
  if (!rate) {
    throw new AppError(404, "Delivery rate not found");
  }
  const originScope = await getBranchOriginScope(actor);
  if (originScope && rate.origin_location_id !== originScope) {
    throw new AppError(404, "Delivery rate not found");
  }
  const updated = await prisma.delivery_rates.update({ where: { id }, data: { is_active: isActive } });
  await invalidateRateCache(rate.origin_location_id, rate.destination_location_id);
  return updated;
}

// Nothing else stores a delivery_rates id (a parcel's price is computed and
// stamped onto the order at booking time, not linked back to this row), so a
// hard delete is safe with no dependent-record check, unlike deleteLocation.
export async function deleteDeliveryRate(actor: Actor, id: string) {
  const rate = await prisma.delivery_rates.findUnique({ where: { id } });
  if (!rate) {
    throw new AppError(404, "Delivery rate not found");
  }
  const originScope = await getBranchOriginScope(actor);
  if (originScope && rate.origin_location_id !== originScope) {
    throw new AppError(404, "Delivery rate not found");
  }
  await prisma.delivery_rates.delete({ where: { id } });
  await invalidateRateCache(rate.origin_location_id, rate.destination_location_id);
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
    returnPercent: Number(rate.return_percent),
    branchReturnPercent: rate.branch_return_percent === null ? null : Number(rate.branch_return_percent),
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

// A return parcel on a configured (origin -> destination) route is charged a
// percent of that route's delivery charge - the route-table analogue of the
// vendor model's getReturnDeliveryQuote. branch_delivery uses branch_return_percent
// when set, else return_percent; an unset/zero percent means a free return.
export async function getReturnRouteQuote(
  originLocationId: string,
  destinationLocationId: string,
  weightKg: number,
  serviceType: "home_delivery" | "branch_delivery" = "home_delivery",
): Promise<DeliveryQuote & { returnPercent: number; baseDeliveryCharge: number }> {
  const delivery = await getDeliveryQuote(originLocationId, destinationLocationId, weightKg, serviceType);
  const rate = await getActiveRate(originLocationId, destinationLocationId);
  const percent =
    serviceType === "branch_delivery" && rate.branchReturnPercent !== null
      ? rate.branchReturnPercent
      : rate.returnPercent;
  const totalPayable = Math.round(delivery.totalPayable * (percent / 100) * 100) / 100;
  return {
    baseCharge: totalPayable,
    weightSurcharge: 0,
    totalPayable,
    freeWeightKg: delivery.freeWeightKg,
    extraWeightPercent: delivery.extraWeightPercent,
    returnPercent: percent,
    baseDeliveryCharge: delivery.totalPayable,
  };
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
    flatOutsideRingRoad: n(vendor.flat_outside_ring_road),
    zoneMajorCities: n(vendor.zone_major_cities),
    zoneUrbanAreas: n(vendor.zone_urban_areas),
    zoneRemoteAreas: n(vendor.zone_remote_areas),
    zoneInsideValley: n(vendor.zone_inside_valley),
    insideValleyFlatRate: n(vendor.inside_valley_flat_rate),
    extraWeightPercent: n(vendor.extra_weight_percent),
    branchFlatInsideValley: n(vendor.branch_flat_inside_valley),
    branchFlatOutsideValley: n(vendor.branch_flat_outside_valley),
    branchFlatOutsideRingRoad: n(vendor.branch_flat_outside_ring_road),
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

  // Covered areas are the active child locations of each destination. Fetch them
  // all in one query and group by parent so each destination row can list them.
  const coveredAreaRows = await prisma.locations.findMany({
    where: { parent_id: { in: destinations.map((d) => d.id) }, is_active: true },
    orderBy: { name: "asc" },
    select: { name: true, parent_id: true },
  });
  const coveredAreasByDest = new Map<string, string[]>();
  for (const area of coveredAreaRows) {
    if (!area.parent_id) continue;
    const list = coveredAreasByDest.get(area.parent_id) ?? [];
    list.push(area.name);
    coveredAreasByDest.set(area.parent_id, list);
  }

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
        coveredAreas: coveredAreasByDest.get(dest.id) ?? [],
        zone: dest.zone,
        valley: dest.valley,
        ringRoad: dest.ring_road,
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

// Single-destination quick quote for THIS vendor (their own rate model +
// overrides, same resolution as getVendorSelfRates) - used to price a
// shipment before booking it, without pulling the whole rate card.
export async function getVendorSingleQuote(
  actor: Actor,
  destinationLocationId: string,
  weightKg = 1,
  serviceType: "home_delivery" | "branch_delivery" = "home_delivery",
) {
  const vendor = await resolveActorVendor(actor);
  if (!vendor) throw new AppError(404, "No vendor profile found for this account");

  const overrides = buildVendorOverrides(vendor);
  const rateType = (vendor.rate_type as RateType) ?? "flat";

  return getVendorQuote(rateType, destinationLocationId, weightKg, overrides, serviceType);
}
