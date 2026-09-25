import prisma from "../../lib/prisma";
import { isStaffActor } from "../vendor-scope.service";
import { getBranchVendorFlatQuote, getReturnDeliveryQuote, type RateType, type ServiceType } from "../pricing.service";
import type { OrderActor } from "./types";

// Maps a vendor row's branch-rate override columns to VendorRateOverrides keys.
function branchOverrides(v: {
  branch_flat_inside_valley: unknown; branch_flat_outside_valley: unknown;
  branch_zone_major_cities: unknown; branch_zone_urban_areas: unknown;
  branch_zone_remote_areas: unknown; branch_zone_inside_valley: unknown;
  branch_return_inside_valley_percent?: unknown; branch_return_outside_valley_percent?: unknown;
}) {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    branchFlatInsideValley: n(v.branch_flat_inside_valley),
    branchFlatOutsideValley: n(v.branch_flat_outside_valley),
    branchZoneMajorCities: n(v.branch_zone_major_cities),
    branchZoneUrbanAreas: n(v.branch_zone_urban_areas),
    branchZoneRemoteAreas: n(v.branch_zone_remote_areas),
    branchZoneInsideValley: n(v.branch_zone_inside_valley),
    branchReturnInsideValleyPercent: n(v.branch_return_inside_valley_percent),
    branchReturnOutsideValleyPercent: n(v.branch_return_outside_valley_percent),
  };
}

type VendorRateRow = Parameters<typeof branchOverrides>[0] & {
  flat_inside_valley: unknown; flat_outside_valley: unknown;
  zone_major_cities: unknown; zone_urban_areas: unknown;
  zone_remote_areas: unknown; zone_inside_valley: unknown;
  inside_valley_flat_rate: unknown; extra_weight_percent: unknown;
  return_inside_valley_percent: unknown; return_outside_valley_percent: unknown;
};

// The overrides order creation and repricing both price a vendor with. Kept as
// the exact field set those two paths already used inline, so head-office
// pricing is unchanged by sharing it.
export function vendorRateOverrides(v: VendorRateRow) {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    flatInsideValley: n(v.flat_inside_valley),
    flatOutsideValley: n(v.flat_outside_valley),
    zoneMajorCities: n(v.zone_major_cities),
    zoneUrbanAreas: n(v.zone_urban_areas),
    zoneRemoteAreas: n(v.zone_remote_areas),
    zoneInsideValley: n(v.zone_inside_valley),
    insideValleyFlatRate: n(v.inside_valley_flat_rate),
    extraWeightPercent: n(v.extra_weight_percent),
    ...branchOverrides(v),
    returnInsideValleyPercent: n(v.return_inside_valley_percent),
    returnOutsideValleyPercent: n(v.return_outside_valley_percent),
  };
}

// A branch vendor on the flat model is charged its own inside/outside-branch
// rate; null when that side isn't set, so the caller keeps the route-rate price.
export async function branchVendorFlatCharge(
  vendor: (VendorRateRow & { rate_type: string | null }) | null | undefined,
  originLocationId: string,
  destinationLocationId: string,
  weightKg: number,
  serviceType: ServiceType,
  isReturn: boolean,
): Promise<number | null> {
  if (!vendor || vendor.rate_type !== "flat") return null;
  const quote = await getBranchVendorFlatQuote(
    originLocationId,
    destinationLocationId,
    weightKg,
    vendorRateOverrides(vendor),
    serviceType,
    isReturn,
  );
  return quote ? quote.totalPayable : null;
}
// The central master hub (Imadol). An order that originates anywhere else is a
// branch-origin order and prices off the (branch → destination) route table.
// Cached for the process; hub identity does not change at runtime.
let masterHubIdCache: string | null | undefined;
export async function getMasterHubId(): Promise<string | null> {
  if (masterHubIdCache !== undefined) return masterHubIdCache;
  const hub = await prisma.locations.findFirst({
    where: { code: { equals: "IMADOL", mode: "insensitive" }, parent_id: null, is_hub: true },
    select: { id: true },
  });
  masterHubIdCache = hub?.id ?? null;
  return masterHubIdCache;
}

// Prices a parcel's return-to-vendor charge as the vendor's return percent of
// the normal rate for that destination/weight - the same discounted quote a
// genuine order_type "return" parcel is priced at from creation (see
// getReturnDeliveryQuote). Used to re-price a plain RTO (a normal delivery
// that failed and bounced back) once it actually reaches the vendor, so both
// paths bill consistently instead of a plain RTO charging the full outbound
// rate. Returns null (leave the existing charge alone) if the quote can't be
// computed, e.g. an unclassified destination.
export async function computeReturnCharge(
  vendor: {
    rate_type: string | null;
    flat_inside_valley: unknown; flat_outside_valley: unknown;
    zone_major_cities: unknown; zone_urban_areas: unknown; zone_remote_areas: unknown; zone_inside_valley: unknown;
    inside_valley_flat_rate: unknown; extra_weight_percent: unknown;
    return_inside_valley_percent: unknown; return_outside_valley_percent: unknown;
    branch_flat_inside_valley: unknown; branch_flat_outside_valley: unknown;
    branch_zone_major_cities: unknown; branch_zone_urban_areas: unknown;
    branch_zone_remote_areas: unknown; branch_zone_inside_valley: unknown;
  } | null | undefined,
  destinationLocationId: string,
  weightKg: number | null,
  serviceType: string,
  /** The parcel's origin. From a branch, a flat vendor's return prices off its inside/outside-branch rate. */
  originLocationId?: string | null,
): Promise<number | null> {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  try {
    const masterHubId = originLocationId ? await getMasterHubId() : null;
    if (vendor && originLocationId && masterHubId && originLocationId !== masterHubId) {
      const flatCharge = await branchVendorFlatCharge(
        vendor,
        originLocationId,
        destinationLocationId,
        weightKg === null ? 1 : weightKg,
        serviceType as ServiceType,
        true,
      );
      if (flatCharge !== null) return flatCharge;
    }
    const quote = await getReturnDeliveryQuote(
      (vendor?.rate_type as RateType) ?? "flat",
      destinationLocationId,
      weightKg === null ? 1 : weightKg,
      vendor
        ? {
            flatInsideValley: n(vendor.flat_inside_valley),
            flatOutsideValley: n(vendor.flat_outside_valley),
            zoneMajorCities: n(vendor.zone_major_cities),
            zoneUrbanAreas: n(vendor.zone_urban_areas),
            zoneRemoteAreas: n(vendor.zone_remote_areas),
            zoneInsideValley: n(vendor.zone_inside_valley),
            insideValleyFlatRate: n(vendor.inside_valley_flat_rate),
            extraWeightPercent: n(vendor.extra_weight_percent),
            ...branchOverrides(vendor),
            returnInsideValleyPercent: n(vendor.return_inside_valley_percent),
            returnOutsideValleyPercent: n(vendor.return_outside_valley_percent),
          }
        : {},
      serviceType as ServiceType,
    );
    return quote.totalPayable;
  } catch {
    return null;
  }
}

// The hub an actor's new order ships from before any vendor is considered: a
// plain (non-super) admin's own hub, else null. Shared with the price preview
// so it resolves origin exactly the way order creation does.
export async function resolveOrderOriginHub(actor: OrderActor): Promise<string | null> {
  if (!isStaffActor(actor) || actor.roles.includes("super_admin")) return null;
  const admin = await prisma.admins.findFirst({ where: { user_id: actor.id }, select: { location_id: true } });
  return admin?.location_id ?? null;
}

