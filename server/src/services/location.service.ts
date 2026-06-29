import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

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
      updated_at: new Date(),
    },
  });

  return mapLocation(loc);
}
