import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { getActorScope, type OrderActor } from "./order.service";
import type { Prisma } from "../generated/prisma/client";

const MAX_REMARK_LENGTH = 2000;

const REMARK_INCLUDE = { users: true } satisfies Prisma.parcel_remarksInclude;

type RemarkRow = Prisma.parcel_remarksGetPayload<{ include: typeof REMARK_INCLUDE }>;

export interface RemarkDto {
  id: string;
  parcelId: string;
  parentRemarkId: string | null;
  remark: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  replies: RemarkDto[];
}

function mapRemark(row: RemarkRow): RemarkDto {
  return {
    id: row.id,
    parcelId: row.parcel_id,
    parentRemarkId: row.parent_remark_id,
    remark: row.remark,
    authorId: row.user_id,
    authorName: row.users?.full_name || "System",
    createdAt: row.created_at.toISOString(),
    replies: [],
  };
}

function assertValidRemarkText(remark: unknown): string {
  if (typeof remark !== "string") {
    throw new AppError(400, "remark is required");
  }
  const trimmed = remark.trim();
  if (!trimmed) {
    throw new AppError(400, "remark cannot be empty");
  }
  if (trimmed.length > MAX_REMARK_LENGTH) {
    throw new AppError(400, `remark cannot exceed ${MAX_REMARK_LENGTH} characters`);
  }
  return trimmed;
}

// Mirrors the vendor/rider scoping rules used for listOrders - a vendor can
// only see/comment on their own parcels, a rider only on parcels they're
// assigned to (either leg). Admins have no scope restriction.
async function loadScopedParcel(actor: OrderActor, parcelId: string) {
  const { vendorId, riderId } = await getActorScope(actor);

  const parcel = await prisma.parcels.findFirst({
    where: { id: parcelId, deleted_at: null },
  });

  if (!parcel) {
    throw new AppError(404, "Order not found");
  }

  if (vendorId && parcel.vendor_id !== vendorId) {
    throw new AppError(403, "Forbidden");
  }

  if (riderId && parcel.pickup_rider_id !== riderId && parcel.delivery_rider_id !== riderId) {
    throw new AppError(403, "Forbidden");
  }

  return parcel;
}

export async function listRemarks(actor: OrderActor, parcelId: string): Promise<RemarkDto[]> {
  await loadScopedParcel(actor, parcelId);

  const rows = await prisma.parcel_remarks.findMany({
    where: { parcel_id: parcelId },
    include: REMARK_INCLUDE,
    orderBy: { created_at: "asc" },
  });

  const byId = new Map<string, RemarkDto>();
  const topLevel: RemarkDto[] = [];

  for (const row of rows) {
    byId.set(row.id, mapRemark(row));
  }

  for (const row of rows) {
    const mapped = byId.get(row.id)!;
    if (row.parent_remark_id) {
      const parent = byId.get(row.parent_remark_id);
      if (parent) {
        parent.replies.push(mapped);
      }
    } else {
      topLevel.push(mapped);
    }
  }

  // Most recently active thread first; replies stay chronological within a thread.
  return topLevel.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createRemark(
  actor: OrderActor,
  parcelId: string,
  remarkText: unknown,
): Promise<RemarkDto> {
  const trimmed = assertValidRemarkText(remarkText);
  const parcel = await loadScopedParcel(actor, parcelId);

  const created = await prisma.$transaction(async (tx) => {
    const remark = await tx.parcel_remarks.create({
      data: {
        parcel_id: parcel.id,
        user_id: actor.id,
        location_id: parcel.current_location_id,
        remark: trimmed,
      },
      include: REMARK_INCLUDE,
    });

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "ADD_REMARK",
        new_data: { remarkId: remark.id },
      },
    });

    return remark;
  });

  return mapRemark(created);
}

export async function replyToRemark(
  actor: OrderActor,
  parcelId: string,
  remarkId: string,
  remarkText: unknown,
): Promise<RemarkDto> {
  const trimmed = assertValidRemarkText(remarkText);
  const parcel = await loadScopedParcel(actor, parcelId);

  const parent = await prisma.parcel_remarks.findFirst({
    where: { id: remarkId, parcel_id: parcel.id },
  });

  if (!parent) {
    throw new AppError(404, "Remark not found");
  }
  // Keep threading flat (one level deep) so the UI doesn't need to render
  // arbitrarily nested comment trees.
  if (parent.parent_remark_id) {
    throw new AppError(422, "Cannot reply to a reply");
  }

  const created = await prisma.$transaction(async (tx) => {
    const reply = await tx.parcel_remarks.create({
      data: {
        parcel_id: parcel.id,
        user_id: actor.id,
        location_id: parcel.current_location_id,
        parent_remark_id: parent.id,
        remark: trimmed,
      },
      include: REMARK_INCLUDE,
    });

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "REPLY_REMARK",
        new_data: { remarkId: reply.id, parentRemarkId: parent.id },
      },
    });

    return reply;
  });

  return mapRemark(created);
}
