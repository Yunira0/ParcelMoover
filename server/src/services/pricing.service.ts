import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

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
  let settings = await prisma.pricing_settings.findFirst();
  if (!settings) {
    settings = await prisma.pricing_settings.create({ data: {} });
  }
  return {
    id: settings.id,
    zoneMajorCities: settings.zone_major_cities === null ? null : Number(settings.zone_major_cities),
    zoneUrbanAreas: settings.zone_urban_areas === null ? null : Number(settings.zone_urban_areas),
    zoneRemoteAreas: settings.zone_remote_areas === null ? null : Number(settings.zone_remote_areas),
    flatInsideValley: settings.flat_inside_valley === null ? null : Number(settings.flat_inside_valley),
    flatOutsideValley: settings.flat_outside_valley === null ? null : Number(settings.flat_outside_valley),
    freeWeightKg: Number(settings.free_weight_kg),
  };
}

export interface UpdatePricingSettingsInput {
  zoneMajorCities?: number | null;
  zoneUrbanAreas?: number | null;
  zoneRemoteAreas?: number | null;
  flatInsideValley?: number | null;
  flatOutsideValley?: number | null;
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
      ...(input.freeWeightKg !== undefined ? { free_weight_kg: input.freeWeightKg } : {}),
      updated_at: new Date(),
    },
  });
  return getPricingSettings();
}

// Resolve the destination's effective pricing fields, falling back to its parent
// destination when the order targets a covered area that has none of its own.
async function resolveDestinationPricing(destinationLocationId: string) {
  const dest = await prisma.locations.findUnique({ where: { id: destinationLocationId } });
  if (!dest) throw new AppError(400, "Destination location not found");

  let parent: typeof dest | null = null;
  if (dest.parent_id) {
    parent = await prisma.locations.findUnique({ where: { id: dest.parent_id } });
  }

  return {
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
}

// Per-vendor rate overrides; any null field falls back to the global default.
export interface VendorRateOverrides {
  flatInsideValley?: number | null;
  flatOutsideValley?: number | null;
  zoneMajorCities?: number | null;
  zoneUrbanAreas?: number | null;
  zoneRemoteAreas?: number | null;
}

// Computes the delivery charge for a vendor's chosen rate model to a destination,
// honouring per-vendor overrides before falling back to the global defaults.
export async function getVendorQuote(
  rateType: RateType,
  destinationLocationId: string,
  _weightKg = 1,
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

  // Flat per type — no extra-weight surcharge in this model.
  return {
    baseCharge: rate,
    weightSurcharge: 0,
    totalPayable: rate,
    freeWeightKg: settings.freeWeightKg,
    rateType,
    basis,
  };
}
