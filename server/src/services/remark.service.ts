import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { ListRemarksParams } from "../types/remark.type";

type Actor = { id: string; roles: string[] };

export type RemarkWorkflowStatus = "open" | "pending" | "closed";

const WORKFLOW_STATUSES: RemarkWorkflowStatus[] = ["open", "pending", "closed"];

const isStaff = (actor: Actor) =>
  actor.roles.includes("admin") || actor.roles.includes("super_admin");

// Un-opened remarks (null workflow_status, or a legacy "pending") read as
// "pending" until a staff member opens the remark, which flips it to "open".
// "closed" is resolved.
const normalizeStatus = (status: string | null): RemarkWorkflowStatus => {
  if (status === "closed") return "closed";
  if (status === "open") return "open";
  return "pending";
};

// Vendors and their staff only see remarks on their vendor's parcels; admins see everything.
async function scopeWhere(actor: Actor, extra: Record<string, unknown> = {}) {
  if (isStaff(actor)) return extra;

  // Sales: remarks on parcels belonging to any of the vendors (clients) they own.
  if (actor.roles.includes("sales")) {
    const owned = await prisma.vendors.findMany({
      where: { sales_user_id: actor.id, deleted_at: null },
      select: { id: true },
    });
    return { ...extra, parcels: { vendor_id: { in: owned.map((v) => v.id) } } };
  }

  let vendorId: string | null = null;

  if (actor.roles.includes("vendor")) {
    const vendor = await prisma.vendors.findFirst({
      where: { user_id: actor.id, deleted_at: null },
      select: { id: true },
    });
    vendorId = vendor?.id ?? null;
  } else if (actor.roles.includes("vendor_staff")) {
    const staffRecord = await prisma.vendor_staff.findFirst({
      where: { user_id: actor.id, deleted_at: null, enabled: true },
      select: { vendor_id: true },
    });
    vendorId = staffRecord?.vendor_id ?? null;
  }

  if (!vendorId) throw new AppError(403, "No vendor profile found");
  return { ...extra, parcels: { vendor_id: vendorId } };
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

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Author filter for "unclosed comments": only remarks raised by a vendor
// (owner/staff) or a rider — not internal admin/staff notes.
const VENDOR_RIDER_AUTHOR = {
  user_roles: { some: { roles: { code: { in: ["vendor", "vendor_staff", "rider"] } } } },
};

export async function listRemarks(actor: Actor, params: ListRemarksParams = {}) {
  const where: Record<string, unknown> = await scopeWhere(actor);

  if (params.unclosed) {
    where.workflow_status = { not: "closed" };
    // Unclosed comments track only vendor- and rider-raised remarks, not
    // internal staff/admin notes.
    where.users = VENDOR_RIDER_AUTHOR;
  } else if (params.status === "closed") {
    where.workflow_status = "closed";
  } else if (params.status === "open") {
    where.workflow_status = "open";
  } else if (params.status === "pending") {
    // Un-opened: neither open nor closed. Prisma `not` also matches NULL rows,
    // so brand-new remarks (null workflow_status) land here.
    where.AND = [
      { workflow_status: { not: "open" } },
      { workflow_status: { not: "closed" } },
    ];
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

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, params.page ?? 1);
  const skip = (page - 1) * take;

  const [total, remarks] = await Promise.all([
    prisma.parcel_remarks.count({ where }),
    prisma.parcel_remarks.findMany({
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
      orderBy: { created_at: params.sortDir === "asc" ? "asc" : "desc" },
      skip,
      take,
    }),
  ]);

  return {
    data: remarks.map(mapRemark),
    meta: {
      page,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
  };
}

async function findAccessibleRemark(actor: Actor, id: string) {
  const where = await scopeWhere(actor, { id });
  const remark = await prisma.parcel_remarks.findFirst({ where, select: { id: true, workflow_status: true } });
  if (!remark) throw new AppError(404, "Remark not found");
  return remark;
}

export async function getRemarkById(actor: Actor, id: string) {
  await findAccessibleRemark(actor, id);

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

export async function getUnclosedRemarksCount(actor: Actor): Promise<number> {
  const where = await scopeWhere(actor, {
    workflow_status: { not: "closed" },
    users: VENDOR_RIDER_AUTHOR,
  });
  return prisma.parcel_remarks.count({ where });
}
