import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { ListRemarksParams } from "../types/remark.type";

type Actor = { id: string; roles: string[] };

export type RemarkWorkflowStatus = "open" | "pending" | "closed";

const WORKFLOW_STATUSES: RemarkWorkflowStatus[] = ["open", "pending", "closed"];

const isStaff = (actor: Actor) =>
  actor.roles.includes("admin") || actor.roles.includes("super_admin");

const normalizeStatus = (status: string | null): RemarkWorkflowStatus => {
  if (status === "open") return "open";
  if (status === "closed") return "closed";
  return "pending";
};

// Vendors only see remarks on their own parcels; staff see everything.
async function scopeWhere(actor: Actor, extra: Record<string, unknown> = {}) {
  if (isStaff(actor)) return extra;
  const vendor = await prisma.vendors.findFirst({
    where: { user_id: actor.id, deleted_at: null },
    select: { id: true },
  });
  if (!vendor) throw new AppError(403, "No vendor profile found");
  return { ...extra, parcels: { vendor_id: vendor.id } };
}

function mapRemark(remark: {
  id: string;
  remark: string;
  created_at: Date;
  workflow_status: string | null;
  parcels: {
    tracking_id: string;
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
    status: normalizeStatus(remark.workflow_status),
    addedBy: remark.users?.full_name || "Unknown",
    createdAt: remark.created_at.toISOString().slice(0, 10),
  };
}

export async function listRemarks(actor: Actor, params: ListRemarksParams = {}) {
  const where: Record<string, unknown> = await scopeWhere(actor);

  if (params.status && WORKFLOW_STATUSES.includes(params.status as RemarkWorkflowStatus)) {
    where.workflow_status = params.status;
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
          parties_parcels_sender_idToparties: { select: { name: true, phone: true } },
        },
      },
      users: { select: { full_name: true } },
    },
    orderBy: { created_at: "desc" },
  });

  return remarks.map(mapRemark);
}

async function findAccessibleRemark(actor: Actor, id: string) {
  const where = await scopeWhere(actor, { id });
  const remark = await prisma.parcel_remarks.findFirst({ where, select: { id: true, workflow_status: true } });
  if (!remark) throw new AppError(404, "Remark not found");
  return remark;
}

// Viewing a pending remark moves it to "open".
export async function getRemarkById(actor: Actor, id: string) {
  const accessible = await findAccessibleRemark(actor, id);

  if (normalizeStatus(accessible.workflow_status) === "pending") {
    await prisma.parcel_remarks.update({ where: { id }, data: { workflow_status: "open" } });
  }

  const remark = await prisma.parcel_remarks.findUnique({
    where: { id },
    include: {
      parcels: {
        select: {
          id: true,
          tracking_id: true,
          parties_parcels_sender_idToparties: { select: { name: true, phone: true } },
          parties_parcels_receiver_idToparties: { select: { name: true, phone: true } },
        },
      },
    },
  });

  if (!remark) return null;

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
    status: normalizeStatus(remark.workflow_status),
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

export async function setRemarkStatus(actor: Actor, id: string, status: RemarkWorkflowStatus) {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw new AppError(400, "Invalid remark status");
  }
  await findAccessibleRemark(actor, id);
  await prisma.parcel_remarks.update({ where: { id }, data: { workflow_status: status } });
  return { id, status };
}
