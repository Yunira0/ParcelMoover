import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

export type AnnouncementStatus = "draft" | "scheduled" | "live" | "expired";

export interface AnnouncementDTO {
  id: string;
  title: string;
  body: string;
  isEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  status: AnnouncementStatus;
  createdAt: string;
  updatedAt: string;
}

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  is_enabled: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

// Live/scheduled/expired is derived from is_enabled + the date window at read
// time, never stored — see the model comment in schema.prisma for why.
function computeStatus(row: AnnouncementRow, now: Date): AnnouncementStatus {
  if (!row.is_enabled) return "draft";
  if (row.starts_at && row.starts_at > now) return "scheduled";
  if (row.ends_at && row.ends_at < now) return "expired";
  return "live";
}

function toDTO(row: AnnouncementRow, now: Date = new Date()): AnnouncementDTO {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isEnabled: row.is_enabled,
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
    sortOrder: row.sort_order,
    status: computeStatus(row, now),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listAnnouncements(): Promise<AnnouncementDTO[]> {
  const rows = await prisma.announcements.findMany({
    orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
  });
  const now = new Date();
  return rows.map((row) => toDTO(row, now));
}

export async function getAnnouncement(id: string): Promise<AnnouncementDTO> {
  const row = await prisma.announcements.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "Announcement not found");
  return toDTO(row);
}

export interface AnnouncementInput {
  title: string;
  body: string;
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

export async function createAnnouncement(
  input: AnnouncementInput,
  createdBy: string,
): Promise<AnnouncementDTO> {
  if (!input.title.trim()) throw new AppError(400, "A title is required");
  if (!input.body.trim()) throw new AppError(400, "A body is required");
  assertValidWindow(input.startsAt, input.endsAt);

  const row = await prisma.announcements.create({
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      is_enabled: input.isEnabled ?? true,
      starts_at: input.startsAt ? new Date(input.startsAt) : null,
      ends_at: input.endsAt ? new Date(input.endsAt) : null,
      sort_order: input.sortOrder ?? 0,
      created_by: createdBy,
    },
  });
  return toDTO(row);
}

export async function updateAnnouncement(
  id: string,
  input: Partial<AnnouncementInput>,
): Promise<AnnouncementDTO> {
  const existing = await prisma.announcements.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Announcement not found");

  const startsAt = input.startsAt !== undefined ? input.startsAt : existing.starts_at?.toISOString() ?? null;
  const endsAt = input.endsAt !== undefined ? input.endsAt : existing.ends_at?.toISOString() ?? null;
  assertValidWindow(startsAt, endsAt);

  const row = await prisma.announcements.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body.trim() } : {}),
      ...(input.isEnabled !== undefined ? { is_enabled: input.isEnabled } : {}),
      ...(input.startsAt !== undefined ? { starts_at: input.startsAt ? new Date(input.startsAt) : null } : {}),
      ...(input.endsAt !== undefined ? { ends_at: input.endsAt ? new Date(input.endsAt) : null } : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
    },
  });
  return toDTO(row);
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const existing = await prisma.announcements.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Announcement not found");
  await prisma.announcements.delete({ where: { id } });
}

// Every announcement a vendor should see right now, most urgent first
// (lowest sort_order, then newest). No cap here — the dashboard card slices
// to a handful itself; the vendor's full list page shows all of these.
export async function getActiveAnnouncements(): Promise<AnnouncementDTO[]> {
  const now = new Date();
  const rows = await prisma.announcements.findMany({
    where: {
      is_enabled: true,
      OR: [{ starts_at: null }, { starts_at: { lte: now } }],
      AND: [{ OR: [{ ends_at: null }, { ends_at: { gte: now } }] }],
    },
    orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
  });
  return rows.map((row) => toDTO(row, now));
}
