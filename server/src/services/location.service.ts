import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { invalidateDestinationPricingCache, ZONES, VALLEYS } from "./pricing.service";

export interface UpsertLocationInput {
  name: string;
  code?: string | null;
  province?: string | null;
  district?: string | null;
  city?: string | null;
  addressLine?: string | null;
  isHub?: boolean;
  parentId?: string | null; // when set, this location is a covered area under that destination
  isActive?: boolean;
  // Pricing classification (set by super admin in Settings)
  zone?: string | null; // major_cities | urban_areas | remote_areas
  valley?: string | null; // inside | outside
  perDestinationRate?: number | null;
  branchPerDestinationRate?: number | null;
}

function mapLocation(loc: {
  id: string;
  parent_id: string | null;
  name: string;
  code: string | null;
  province: string | null;
  district: string | null;
  city: string | null;
  address_line: string | null;
  is_hub: boolean;
  is_active: boolean;
  zone: string | null;
  valley: string | null;
  per_destination_rate: { toString(): string } | null;
  branch_per_destination_rate: { toString(): string } | null;
}) {
  return {
    id: loc.id,
    parentId: loc.parent_id,
    name: loc.name,
    code: loc.code,
    province: loc.province,
    district: loc.district,
    city: loc.city,
    addressLine: loc.address_line,
    isHub: loc.is_hub,
    isActive: loc.is_active,
    zone: loc.zone,
    valley: loc.valley,
    perDestinationRate: loc.per_destination_rate === null ? null : Number(loc.per_destination_rate),
    branchPerDestinationRate: loc.branch_per_destination_rate === null ? null : Number(loc.branch_per_destination_rate),
  };
}

// Destinations are top-level locations; covered areas are their children. Returns
// destinations each with their nested areas, for the Settings management screen.
export async function listManagedLocations() {
  const all = await prisma.locations.findMany({ orderBy: { name: "asc" } });
  const mapped = all.map(mapLocation);

  const destinations = mapped.filter((l) => !l.parentId);
  return destinations.map((dest) => ({
    ...dest,
    areas: mapped.filter((l) => l.parentId === dest.id),
  }));
}

async function assertNameAvailable(name: string, parentId: string | null, ignoreId?: string) {
  const clash = await prisma.locations.findFirst({
    where: {
      name: { equals: name.trim(), mode: "insensitive" },
      parent_id: parentId,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new AppError(409, parentId ? "An area with this name already exists here" : "A destination with this name already exists");
  }
}

export async function createLocation(input: UpsertLocationInput) {
  const name = input.name?.trim();
  if (!name) throw new AppError(400, "Name is required");

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await prisma.locations.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new AppError(400, "Parent destination not found");
    if (parent.parent_id) throw new AppError(400, "Covered areas can only be nested one level under a destination");
    parentId = parent.id;
  }

  await assertNameAvailable(name, parentId);

  const loc = await prisma.locations.create({
    data: {
      name,
      code: input.code?.trim() || null,
      province: input.province?.trim() || null,
      district: input.district?.trim() || null,
      city: input.city?.trim() || null,
      address_line: input.addressLine?.trim() || null,
      // A destination defaults to a hub; a covered area never is one.
      is_hub: parentId ? false : input.isHub ?? true,
      is_active: input.isActive ?? true,
      parent_id: parentId,
    },
  });

  return mapLocation(loc);
}

export interface BulkImportDestination {
  name: string;
  code?: string;
  province?: string;
  district?: string;
  // Municipality is stored in the locations.city column - in Nepal's
  // administrative structure the municipality IS the city-level unit.
  municipality?: string;
  city?: string;
  zone?: string;
  valley?: string;
  perDestinationRate?: number | null;
  areas: string[];
}

export async function deleteLocation(id: string) {
  const loc = await prisma.locations.findUnique({
    where: { id },
    include: { other_locations: { select: { id: true } } },
  });
  if (!loc) throw new AppError(404, "Location not found");

  // Collect IDs that will be removed (destination + all its areas)
  const idsToCheck = loc.parent_id ? [id] : [id, ...loc.other_locations.map((a) => a.id)];

  const parcelCount = await prisma.parcels.count({
    where: {
      deleted_at: null,
      OR: [
        { origin_location_id: { in: idsToCheck } },
        { destination_location_id: { in: idsToCheck } },
        { current_location_id: { in: idsToCheck } },
      ],
    },
  });
  if (parcelCount > 0)
    throw new AppError(409, "Cannot delete: this location is referenced by active orders.");

  const dispatchCount = await prisma.dispatches.count({
    where: {
      OR: [
        { from_location_id: { in: idsToCheck } },
        { to_location_id: { in: idsToCheck } },
      ],
    },
  });
  if (dispatchCount > 0)
    throw new AppError(409, "Cannot delete: this location is referenced by dispatch records.");

  const rateCount = await prisma.delivery_rates.count({
    where: {
      OR: [
        { origin_location_id: { in: idsToCheck } },
        { destination_location_id: { in: idsToCheck } },
      ],
    },
  });
  if (rateCount > 0)
    throw new AppError(409, "Cannot delete: this location has delivery rates. Remove them first.");

  const vendorCount = await prisma.vendors.count({ where: { location_id: { in: idsToCheck } } });
  if (vendorCount > 0)
    throw new AppError(409, "Cannot delete: this location is assigned to one or more vendors.");

  const riderCount = await prisma.riders.count({ where: { location_id: { in: idsToCheck } } });
  if (riderCount > 0)
    throw new AppError(409, "Cannot delete: this location is assigned to one or more riders.");

  const adminCount = await prisma.admins.count({ where: { location_id: { in: idsToCheck } } });
  if (adminCount > 0)
    throw new AppError(409, "Cannot delete: this location is assigned to one or more admins.");

  if (!loc.parent_id) {
    await prisma.locations.deleteMany({ where: { parent_id: id } });
  }
  await prisma.locations.delete({ where: { id } });
  await invalidateDestinationPricingCache();
}

export async function bulkImportLocations(rows: BulkImportDestination[]) {
  const results: Array<{
    destination: string;
    action: "created" | "updated";
    areasCreated: string[];
    areasSkipped: string[];
    error?: string;
  }> = [];

  for (const row of rows) {
    const destName = row.name?.trim();
    if (!destName) {
      results.push({
        destination: row.name || "(blank)",
        action: "created",
        areasCreated: [],
        areasSkipped: [],
        error: "Row skipped: destination name is required",
      });
      continue;
    }

    if (row.zone !== undefined && row.zone !== null && !ZONES.includes(row.zone as (typeof ZONES)[number])) {
      results.push({
        destination: destName,
        action: "created",
        areasCreated: [],
        areasSkipped: [],
        error: `Row skipped: zone must be one of ${ZONES.join(", ")}`,
      });
      continue;
    }

    if (row.valley !== undefined && row.valley !== null && !VALLEYS.includes(row.valley as (typeof VALLEYS)[number])) {
      results.push({
        destination: destName,
        action: "created",
        areasCreated: [],
        areasSkipped: [],
        error: `Row skipped: valley must be one of ${VALLEYS.join(", ")}`,
      });
      continue;
    }

    try {
      let dest = await prisma.locations.findFirst({
        where: { name: { equals: destName, mode: "insensitive" }, parent_id: null },
      });

      let action: "created" | "updated";

      if (!dest) {
        dest = await prisma.locations.create({
          data: {
            name: destName,
            code: row.code?.trim() || null,
            province: row.province?.trim() || null,
            city: (row.municipality ?? row.city)?.trim() || null,
            district: row.district?.trim() || null,
            is_hub: true,
            is_active: true,
            zone: row.zone || null,
            valley: row.valley || null,
            per_destination_rate: row.perDestinationRate ?? null,
          },
        });
        action = "created";
      } else {
        dest = await prisma.locations.update({
          where: { id: dest.id },
          data: {
            ...(row.code !== undefined ? { code: row.code?.trim() || null } : {}),
            ...(row.province !== undefined ? { province: row.province?.trim() || null } : {}),
            ...(row.municipality !== undefined || row.city !== undefined
              ? { city: (row.municipality ?? row.city)?.trim() || null }
              : {}),
            ...(row.district !== undefined ? { district: row.district?.trim() || null } : {}),
            ...(row.zone !== undefined ? { zone: row.zone || null } : {}),
            ...(row.valley !== undefined ? { valley: row.valley || null } : {}),
            ...(row.perDestinationRate !== undefined
              ? { per_destination_rate: row.perDestinationRate }
              : {}),
            updated_at: new Date(),
          },
        });
        action = "updated";
      }

      const areasCreated: string[] = [];
      const areasSkipped: string[] = [];

      for (const areaName of row.areas) {
        const trimmed = areaName.trim();
        if (!trimmed) continue;
        const exists = await prisma.locations.findFirst({
          where: { name: { equals: trimmed, mode: "insensitive" }, parent_id: dest.id },
        });
        if (exists) {
          areasSkipped.push(trimmed);
        } else {
          await prisma.locations.create({
            data: { name: trimmed, is_hub: false, is_active: true, parent_id: dest.id },
          });
          areasCreated.push(trimmed);
        }
      }

      results.push({ destination: destName, action, areasCreated, areasSkipped });
    } catch (err: any) {
      results.push({
        destination: destName,
        action: "created",
        areasCreated: [],
        areasSkipped: [],
        error: err.message || "Unknown error",
      });
    }
  }

  await invalidateDestinationPricingCache();
  return results;
}

export async function updateLocation(id: string, input: Partial<UpsertLocationInput>) {
  const existing = await prisma.locations.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Location not found");

  if (input.name !== undefined && input.name.trim()) {
    await assertNameAvailable(input.name, existing.parent_id, id);
  }

  const loc = await prisma.locations.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
      ...(input.province !== undefined ? { province: input.province?.trim() || null } : {}),
      ...(input.district !== undefined ? { district: input.district?.trim() || null } : {}),
      ...(input.city !== undefined ? { city: input.city?.trim() || null } : {}),
      ...(input.addressLine !== undefined ? { address_line: input.addressLine?.trim() || null } : {}),
      ...(input.isHub !== undefined && !existing.parent_id ? { is_hub: input.isHub } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      ...(input.zone !== undefined ? { zone: input.zone || null } : {}),
      ...(input.valley !== undefined ? { valley: input.valley || null } : {}),
      ...(input.perDestinationRate !== undefined
        ? { per_destination_rate: input.perDestinationRate }
        : {}),
      ...(input.branchPerDestinationRate !== undefined
        ? { branch_per_destination_rate: input.branchPerDestinationRate }
        : {}),
      updated_at: new Date(),
    },
  });

  await invalidateDestinationPricingCache();
  return mapLocation(loc);
}
