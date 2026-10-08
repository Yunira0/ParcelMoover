import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { banner_display_type } from "../generated/prisma/enums";

export type BannerDisplayType = "modal" | "permanent";
export type BannerStatus = "draft" | "scheduled" | "live" | "expired";

export interface BannerDTO {
  id: string;
  name: string;
  imagePath: string;
  linkUrl: string | null;
  displayType: BannerDisplayType;
  isEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  status: BannerStatus;
  createdAt: string;
  updatedAt: string;
}

type BannerRow = {
  id: string;
  name: string;
  image_path: string;
  link_url: string | null;
  display_type: banner_display_type;
  is_enabled: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

// Live/scheduled/expired is derived from is_enabled + the date window at read
// time, never stored — see the model comment in schema.prisma for why.
function computeStatus(row: BannerRow, now: Date): BannerStatus {
  if (!row.is_enabled) return "draft";
  if (row.starts_at && row.starts_at > now) return "scheduled";
  if (row.ends_at && row.ends_at < now) return "expired";
  return "live";
}

function toDTO(row: BannerRow, now: Date = new Date()): BannerDTO {
  return {
    id: row.id,
    name: row.name,
    imagePath: row.image_path,
    linkUrl: row.link_url,
    displayType: row.display_type,
    isEnabled: row.is_enabled,
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
    sortOrder: row.sort_order,
    status: computeStatus(row, now),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listBanners(): Promise<BannerDTO[]> {
  const rows = await prisma.banners.findMany({
    orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
  });
  const now = new Date();
  return rows.map((row) => toDTO(row, now));
}

export async function getBanner(id: string): Promise<BannerDTO> {
  const row = await prisma.banners.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "Banner not found");
  return toDTO(row);
}

export interface BannerInput {
  name: string;
  linkUrl?: string | null;
  displayType?: BannerDisplayType;
  isEnabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

function assertValidWindow(startsAt?: string | null, endsAt?: string | null) {
  if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
    throw new AppError(400, "End date must be after start date");
  }
}

export async function createBanner(
  input: BannerInput,
  imagePath: string,
  createdBy: string,
): Promise<BannerDTO> {
  if (!input.name.trim()) throw new AppError(400, "A banner name is required");
  assertValidWindow(input.startsAt, input.endsAt);

  const row = await prisma.banners.create({
    data: {
      name: input.name.trim(),
      image_path: imagePath,
      link_url: input.linkUrl?.trim() || null,
      display_type: input.displayType ?? "permanent",
      is_enabled: input.isEnabled ?? true,
      starts_at: input.startsAt ? new Date(input.startsAt) : null,
      ends_at: input.endsAt ? new Date(input.endsAt) : null,
      sort_order: input.sortOrder ?? 0,
      created_by: createdBy,
    },
  });
  return toDTO(row);
}

export async function updateBanner(
  id: string,
  input: Partial<BannerInput>,
  imagePath?: string,
): Promise<BannerDTO> {
  const existing = await prisma.banners.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Banner not found");

  const startsAt = input.startsAt !== undefined ? input.startsAt : existing.starts_at?.toISOString() ?? null;
  const endsAt = input.endsAt !== undefined ? input.endsAt : existing.ends_at?.toISOString() ?? null;
  assertValidWindow(startsAt, endsAt);

  const row = await prisma.banners.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(imagePath ? { image_path: imagePath } : {}),
      ...(input.linkUrl !== undefined ? { link_url: input.linkUrl?.trim() || null } : {}),
      ...(input.displayType !== undefined ? { display_type: input.displayType } : {}),
      ...(input.isEnabled !== undefined ? { is_enabled: input.isEnabled } : {}),
      ...(input.startsAt !== undefined ? { starts_at: input.startsAt ? new Date(input.startsAt) : null } : {}),
      ...(input.endsAt !== undefined ? { ends_at: input.endsAt ? new Date(input.endsAt) : null } : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
    },
  });
  return toDTO(row);
}

export async function deleteBanner(id: string): Promise<void> {
  const existing = await prisma.banners.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Banner not found");
  await prisma.banners.delete({ where: { id } });
}

export interface ActiveBanners {
  modal: BannerDTO | null;
  permanent: BannerDTO | null;
}

// The one live banner of each type a vendor should see right now — lowest
// sort_order first, most recently created breaking any tie. Deliberately
// picks at most one per type rather than a list: stacking several hero
// banners (or spamming several modals in a row) would fight the calm,
// low-noise dashboard the rest of the app commits to.
export async function getActiveBanners(): Promise<ActiveBanners> {
  const now = new Date();
  const rows = await prisma.banners.findMany({
    where: {
      is_enabled: true,
      OR: [{ starts_at: null }, { starts_at: { lte: now } }],
      AND: [{ OR: [{ ends_at: null }, { ends_at: { gte: now } }] }],
    },
    orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
  });

  const modal = rows.find((r) => r.display_type === "modal");
  const permanent = rows.find((r) => r.display_type === "permanent");
  return {
    modal: modal ? toDTO(modal, now) : null,
    permanent: permanent ? toDTO(permanent, now) : null,
  };
}
