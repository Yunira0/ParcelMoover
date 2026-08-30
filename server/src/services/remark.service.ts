import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { ListRemarksParams, RemarkAuthorGroup } from "../types/remark.type";
import { displayAuthor, stripCarrierStaffTag } from "../utils/carrierRemark";
import { nepalDayRangeUtc } from "../utils/nepalTime";

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

function mapRemark(
  remark: {
    id: string;
    remark: string;
    created_at: Date;
    workflow_status: string | null;
    parcels: {
      tracking_id: string;
      parties_parcels_sender_idToparties: { name: string; phone: string };
    };
    users: { full_name: string } | null;
  },
  lastActivity?: { remark: string; created_at: Date; addedBy: string } | null,
) {
  const subject = stripCarrierStaffTag(remark.remark);
  const last = lastActivity ? stripCarrierStaffTag(lastActivity.remark) : subject;
  return {
    id: remark.id,
    remarkId: `RMK-${remark.id.slice(0, 8).toUpperCase()}`,
    trackingId: remark.parcels.tracking_id,
    customerName: remark.parcels.parties_parcels_sender_idToparties.name,
    customerPhone: remark.parcels.parties_parcels_sender_idToparties.phone,
    subject: subject.text,
    status: normalizeStatus(remark.workflow_status),
    addedBy: displayAuthor(remark.users?.full_name, subject.isCarrierStaff),
    createdAt: remark.created_at.toISOString().slice(0, 10),
    lastRemark: last.text,
    lastRemarkBy: displayAuthor(lastActivity?.addedBy ?? remark.users?.full_name, last.isCarrierStaff),
    lastRemarkAt: (lastActivity?.created_at ?? remark.created_at).toISOString(),
  };
}

// The most recent message in each thread (root or reply) - a thread's row in
// the list stays anchored to its root remark, so this is the only way to
// surface newer replies without opening the detail page. Scoped to each
// thread's own root + replies (not the whole parcel), so two separate
// threads on the same parcel don't bleed their "last activity" into each
// other's row.
async function resolveLastActivityByRemark(
  rootIds: string[],
): Promise<Map<string, { remark: string; created_at: Date; addedBy: string }>> {
  const result = new Map<string, { remark: string; created_at: Date; addedBy: string }>();
  const ids = [...new Set(rootIds)];
  if (ids.length === 0) return result;

  const activity = await prisma.parcel_remarks.findMany({
    where: { OR: [{ id: { in: ids } }, { parent_remark_id: { in: ids } }] },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      parent_remark_id: true,
      remark: true,
      created_at: true,
      users: { select: { full_name: true } },
    },
  });

  // Rows arrive newest-first, so the first hit per thread root is the latest.
  activity.forEach((row) => {
    const rootId = row.parent_remark_id ?? row.id;
    if (result.has(rootId)) return;
    result.set(rootId, {
      remark: row.remark,
      created_at: row.created_at,
      // Left empty rather than resolved here - mapRemark decides the label,
      // since only it knows whether the remark carries a carrier tag.
      addedBy: row.users?.full_name || "",
    });
  });

  return result;
}

const DEFAULT_PAGE_SIZE = 20;
// 500 so the list can offer the same largest page as every other screen.
const MAX_PAGE_SIZE = 500;

// Author filters for "unclosed comments": only remarks raised by a vendor
// (owner/staff) or a rider — not internal admin/staff notes. The two groups get
// their own views ("Unclosed cmt" vs "Rider cmt"), so they're split here and
// recombined only for the all-authors total.
const AUTHOR_ROLE_CODES: Record<RemarkAuthorGroup, string[]> = {
  vendor: ["vendor", "vendor_staff"],
  rider: ["rider"],
};

const ALL_AUTHOR_ROLE_CODES = Object.values(AUTHOR_ROLE_CODES).flat();

const authorFilter = (group?: RemarkAuthorGroup) => ({
  user_roles: {
    some: { roles: { code: { in: group ? AUTHOR_ROLE_CODES[group] : ALL_AUTHOR_ROLE_CODES } } },
  },
});

/**
 * What "an unclosed comment" means, in one place: a root remark (replies live
 * inside the thread and are not their own item of work), raised by a vendor or
 * a rider rather than by staff or by one of the sync jobs, and not yet closed.
 *
 * Exported because the dashboard counts the same thing from order.service - the
 * nav badge, the Today's-activity row and the remarks SLA all have to agree, and
 * they only did when each one stopped writing this filter out for itself. Omit
 * `group` for both queues, or narrow to one.
 */
export const unclosedRemarksWhere = (group?: RemarkAuthorGroup) => ({
  workflow_status: { not: "closed" },
  parent_remark_id: null,
  users: authorFilter(group),
});

export async function listRemarks(actor: Actor, params: ListRemarksParams = {}) {
  // Only root remarks are their own table row; replies live inside the thread
  // (see getRemarkById) so posting one doesn't spawn a new row with the reply
  // text sitting in the SUBJECT column.
  const where: Record<string, unknown> = await scopeWhere(actor, { parent_remark_id: null });

  if (params.unclosed) {
    where.workflow_status = { not: "closed" };
    // Unclosed comments track only vendor- and rider-raised remarks, not
    // internal staff/admin notes. `author` narrows that to one of the two.
    where.users = authorFilter(params.author);
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
    // created_at is a timestamptz: `lte: new Date("2026-08-20")` is that day's
    // UTC midnight, so it excluded the whole of the requested end day and sat
    // 5h45m off Nepal local midnight at both ends.
    where.created_at = nepalDayRangeUtc(params.fromDate, params.toDate);
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

  const [total, statusGroups, remarks] = await Promise.all([
    prisma.parcel_remarks.count({ where }),
    // Status breakdown over the whole filtered set, not just the current page -
    // the caller's summary chips have to agree with `total` (and with the nav
    // badge), which counting the returned rows client-side cannot do.
    prisma.parcel_remarks.groupBy({
      by: ["workflow_status"],
      where,
      _count: { _all: true },
    }),
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

  const lastActivityByRemark = await resolveLastActivityByRemark(remarks.map((r) => r.id));

  const statusCounts: Record<RemarkWorkflowStatus, number> = { open: 0, pending: 0, closed: 0 };
  statusGroups.forEach((group) => {
    statusCounts[normalizeStatus(group.workflow_status)] += group._count._all;
  });

  return {
    data: remarks.map((remark) => mapRemark(remark, lastActivityByRemark.get(remark.id))),
    meta: {
      page,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
      statusCounts,
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
    thread: thread.map((entry) => {
      const stripped = stripCarrierStaffTag(entry.remark);
      const parentStripped = entry.parent_remark ? stripCarrierStaffTag(entry.parent_remark.remark) : null;
      return {
        id: entry.id,
        remark: stripped.text,
        addedBy: displayAuthor(entry.users?.full_name, stripped.isCarrierStaff),
        createdAt: entry.created_at.toISOString(),
        parentRemarkId: entry.parent_remark_id,
        parentAuthor: parentStripped?.isCarrierStaff
          ? "Staff"
          : entry.parent_remark?.users?.full_name || null,
        parentSnippet: parentStripped?.text ?? null,
      };
    }),
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

export interface UnclosedRemarkCounts {
  /** Both groups. Counted with a combined filter rather than vendor + rider, so
   *  an account holding both a vendor and a rider role isn't tallied twice. */
  total: number;
  vendor: number;
  rider: number;
}

export async function getUnclosedRemarksCounts(actor: Actor): Promise<UnclosedRemarkCounts> {
  const countFor = async (group?: RemarkAuthorGroup) =>
    prisma.parcel_remarks.count({
      where: await scopeWhere(actor, unclosedRemarksWhere(group)),
    });

  const [total, vendor, rider] = await Promise.all([countFor(), countFor("vendor"), countFor("rider")]);
  return { total, vendor, rider };
}
