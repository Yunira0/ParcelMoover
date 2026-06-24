import prisma from "../lib/prisma";
import { ListRemarksParams } from "../types/remark.type";
import { parcel_status } from "../generated/prisma/enums";

const VALID_STATUSES: string[] = Object.values(parcel_status);

function mapRemark(remark: {
  id: string;
  remark: string;
  created_at: Date;
  parcels: {
    tracking_id: string;
    status: string;
    parties_parcels_sender_idToparties: { name: string; phone: string };
  };
  users: { full_name: string } | null;
}) {
  return {
    id: remark.id,
    remarkId: `RMK-${remark.id.slice(0, 8).toUpperCase()}`,
    trackingId: remark.parcels.tracking_id,
    customerName: remark.parcels.parties_parcels_sender_idToparties.name,
    customerPhone: remark.parcels.parties_parcels_sender_idToparties.phone,
    subject: remark.remark,
    status: remark.parcels.status,
    addedBy: remark.users?.full_name || "Unknown",
    createdAt: remark.created_at.toISOString().slice(0, 10),
  };
}

export async function listRemarks(params: ListRemarksParams = {}) {
  const where: Record<string, unknown> = {};

  if (params.status && VALID_STATUSES.includes(params.status)) {
    where.parcels = { status: params.status };
  }

  if (params.fromDate || params.toDate) {
    const createdAt: Record<string, Date> = {};
    if (params.fromDate) createdAt.gte = new Date(params.fromDate);
    if (params.toDate) createdAt.lte = new Date(params.toDate);
    where.created_at = createdAt;
  }

  if (params.search) {
    const q = params.search.trim();
    where.OR = [
      { remark: { contains: q, mode: "insensitive" } },
      { parcels: { tracking_id: { contains: q, mode: "insensitive" } } },
      { parcels: { parties_parcels_sender_idToparties: { name: { contains: q, mode: "insensitive" } } } },
      { parcels: { parties_parcels_sender_idToparties: { phone: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const remarks = await prisma.parcel_remarks.findMany({
    where,
    include: {
      parcels: {
        select: {
          tracking_id: true,
          status: true,
          parties_parcels_sender_idToparties: { select: { name: true, phone: true } },
        },
      },
      users: { select: { full_name: true } },
    },
    orderBy: { created_at: "desc" },
  });

  return remarks.map(mapRemark);
}

export async function getRemarkById(id: string) {
  const remark = await prisma.parcel_remarks.findUnique({
    where: { id },
    include: {
      parcels: {
        select: {
          id: true,
          tracking_id: true,
          status: true,
          parties_parcels_sender_idToparties: { select: { name: true, phone: true } },
          parties_parcels_receiver_idToparties: { select: { name: true, phone: true } },
        },
      },
    },
  });

  if (!remark) {
    return null;
  }

  const thread = await prisma.parcel_remarks.findMany({
    where: { parcel_id: remark.parcel_id },
    include: { users: { select: { full_name: true } }, parent_remark: { include: { users: { select: { full_name: true } } } } },
    orderBy: { created_at: "asc" },
  });

  return {
    id: remark.id,
    remarkId: `RMK-${remark.id.slice(0, 8).toUpperCase()}`,
    parcelId: remark.parcels.id,
    trackingId: remark.parcels.tracking_id,
    status: remark.parcels.status,
    senderName: remark.parcels.parties_parcels_sender_idToparties.name,
    senderPhone: remark.parcels.parties_parcels_sender_idToparties.phone,
    receiverName: remark.parcels.parties_parcels_receiver_idToparties.name,
    receiverPhone: remark.parcels.parties_parcels_receiver_idToparties.phone,
    thread: thread.map((entry) => ({
      id: entry.id,
      remark: entry.remark,
      addedBy: entry.users?.full_name || "Unknown",
      createdAt: entry.created_at.toISOString(),
      parentRemarkId: entry.parent_remark_id,
      parentAuthor: entry.parent_remark?.users?.full_name || null,
      parentSnippet: entry.parent_remark?.remark || null,
    })),
  };
}
