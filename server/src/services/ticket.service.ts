import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { getDatePart, randomBase32 } from "../utils/trackingId";
import { CreateTicketInput, ListTicketsParams, TicketStatus } from "../types/ticket.type";
import { createNotification } from "./notification.service";
import { notifyAdmins } from "./order.service";

type Actor = { id: string; roles: string[] };

// Vendor-raised tickets in these categories page a specific admin module -
// mirrors the notification `type` strings the sidebar badges/bell already
// key off of (see order.service.ts's pickup/dispatch/cod_settlement events).
const TICKET_CATEGORY_NOTIFICATIONS: Record<string, { type: string; label: string }> = {
  pickup: { type: "pickup", label: "Pickup" },
  delivery: { type: "dispatch", label: "Delivery" },
  cod_settlement: { type: "cod_settlement", label: "COD Settlement" },
  loss_and_damage: { type: "loss_and_damage", label: "Loss & Damage" },
};

// Workflow: pending (un-opened) → open (staff opened it) → closed (resolved).
// Legacy in_progress reads as open; resolved reads as closed.
const WORKFLOW_STATUSES: TicketStatus[] = ["open", "pending", "closed"];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const isStaff = (actor: Actor) =>
  actor.roles.includes("admin") || actor.roles.includes("super_admin");

function generateTicketNo(date = new Date()) {
  return `TKT-${getDatePart(date)}-${randomBase32(6)}`;
}

// Map any stored status onto the pending/open/closed workflow.
function normalizeStatus(status: string): TicketStatus {
  if (status === "closed" || status === "resolved") return "closed";
  if (status === "pending") return "pending";
  return "open"; // open, in_progress, or anything else
}

function mapTicket(ticket: {
  id: string;
  ticket_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  subject: string | null;
  issue_type: string;
  category: string | null;
  priority: string | null;
  description: string | null;
  status: string;
  created_at: Date;
  users_support_tickets_assigned_toTousers?: { full_name: string } | null;
}) {
  return {
    id: ticket.id,
    ticketId: ticket.ticket_no,
    customerName: ticket.customer_name || "",
    customerPhone: ticket.customer_phone || "",
    subject: ticket.subject || ticket.issue_type,
    category: ticket.category || "general",
    priority: ticket.priority || "medium",
    description: ticket.description || "",
    status: normalizeStatus(ticket.status),
    assignedTo: ticket.users_support_tickets_assigned_toTousers?.full_name || "Unassigned",
    createdAt: ticket.created_at.toISOString().slice(0, 10),
  };
}

const TICKET_INCLUDE = {
  users_support_tickets_assigned_toTousers: true,
} as const;

// Resolves the vendor (name + phone) behind a batch of ticket creators in a
// couple of queries, so the ticket list can show vendor details without an
// N+1 lookup. Creators are matched as vendor owners first, then vendor staff.
async function resolveVendorsByCreators(userIds: string[]) {
  const map = new Map<string, { name: string; phone: string }>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return map;

  const owners = await prisma.vendors.findMany({
    where: { user_id: { in: ids }, deleted_at: null },
    select: { user_id: true, business_name: true, client_name: true, phone: true },
  });
  owners.forEach((v) => {
    if (v.user_id) map.set(v.user_id, { name: v.business_name || v.client_name, phone: v.phone });
  });

  const remaining = ids.filter((id) => !map.has(id));
  if (remaining.length > 0) {
    const staff = await prisma.vendor_staff.findMany({
      where: { user_id: { in: remaining }, deleted_at: null },
      select: { user_id: true, vendor_id: true },
    });
    const vendorIds = [...new Set(staff.map((s) => s.vendor_id))];
    if (vendorIds.length > 0) {
      const vendors = await prisma.vendors.findMany({
        where: { id: { in: vendorIds }, deleted_at: null },
        select: { id: true, business_name: true, client_name: true, phone: true },
      });
      const byId = new Map(
        vendors.map((v) => [v.id, { name: v.business_name || v.client_name, phone: v.phone }]),
      );
      staff.forEach((s) => {
        const v = byId.get(s.vendor_id);
        if (v && s.user_id) map.set(s.user_id, v);
      });
    }
  }
  return map;
}

// Vendors can only touch tickets they created; staff (admin) can touch any;
// sales see tickets tied to parcels owned by one of their vendors (clients).
async function scopeWhere(actor: Actor, extra: Record<string, unknown> = {}) {
  if (isStaff(actor)) return extra;

  if (actor.roles.includes("sales")) {
    // Tickets are linked to their creator (created_by), not to a parcel - the
    // create path never sets parcel_id. So a parcels.vendor_id filter matched
    // nothing and sales saw no tickets. Scope instead to tickets raised by any
    // owner or staff account of the vendors this sales rep owns.
    const owned = await prisma.vendors.findMany({
      where: { sales_user_id: actor.id, deleted_at: null },
      select: { id: true, user_id: true },
    });
    const creatorIds = owned
      .map((v) => v.user_id)
      .filter((id): id is string => !!id);
    if (owned.length > 0) {
      const staff = await prisma.vendor_staff.findMany({
        where: { vendor_id: { in: owned.map((v) => v.id) }, deleted_at: null },
        select: { user_id: true },
      });
      for (const s of staff) if (s.user_id) creatorIds.push(s.user_id);
    }
    return { ...extra, created_by: { in: creatorIds } };
  }

  return { ...extra, created_by: actor.id };
}

export async function createTicket(actor: Actor, input: CreateTicketInput) {
  if (!input.subject?.trim()) {
    throw new AppError(400, "Subject is required");
  }

  const ticket = await prisma.support_tickets.create({
    data: {
      ticket_no: generateTicketNo(),
      customer_name: input.customerName?.trim() || null,
      customer_phone: input.customerPhone?.trim() || null,
      subject: input.subject.trim(),
      issue_type: input.category?.trim() || input.subject.trim(),
      category: input.category?.trim() || null,
      priority: input.priority?.trim() || null,
      description: input.description?.trim() || null,
      status: "pending", // un-opened until support opens it
      assigned_to: input.assignedTo || null,
      created_by: actor.id,
    },
    include: TICKET_INCLUDE,
  });

  if (ticket.assigned_to && ticket.assigned_to !== actor.id) {
    await createNotification(
      ticket.assigned_to,
      `Ticket ${ticket.ticket_no} assigned to you`,
      ticket.subject,
      null,
      "general",
      `/tickets`,
    );
  }

  // Event-driven fan-out: every vendor-raised ticket notifies all admins.
  // Mapped categories (Pickup/Delivery/COD/L&D) use a category-specific
  // notification type so per-module badge buttons keep working; unmapped
  // categories fall back to a generic "ticket" type.
  const isVendorActor = actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
  if (isVendorActor) {
    const target = ticket.category ? TICKET_CATEGORY_NOTIFICATIONS[ticket.category] : undefined;
    const notifType = target?.type ?? "ticket";
    const notifLabel = target?.label ?? ticket.category ?? "General";
    await notifyAdmins(
      `New ${notifLabel} Ticket: ${ticket.ticket_no}`,
      ticket.subject,
      ticket.id,
      notifType,
      `/tickets/${ticket.id}`,
    );
  }

  // When an admin/staff creates a ticket linked to a parcel, notify the
  // vendor who owns that parcel so they can respond promptly.
  if (isStaff(actor) && input.parcelId) {
    const parcel = await prisma.parcels.findUnique({
      where: { id: input.parcelId },
      select: { vendor_id: true },
    });
    if (parcel?.vendor_id) {
      const vendor = await prisma.vendors.findUnique({
        where: { id: parcel.vendor_id },
        select: { user_id: true },
      });
      if (vendor?.user_id && vendor.user_id !== actor.id) {
        await createNotification(
          vendor.user_id,
          `New Ticket: ${ticket.ticket_no}`,
          ticket.subject,
          ticket.id,
          "ticket",
          `/tickets/${ticket.id}`,
        );
      }
    }
  }

  return mapTicket(ticket);
}

export async function listTickets(actor: Actor, params: ListTicketsParams = {}) {
  const where: Record<string, unknown> = await scopeWhere(actor);

  // Group stored statuses into the pending/open/closed workflow so legacy rows
  // (in_progress, resolved) still land in the right tab.
  if (params.status === "closed") {
    where.status = { in: ["closed", "resolved"] };
  } else if (params.status === "pending") {
    where.status = "pending";
  } else if (params.status === "open") {
    where.status = { in: ["open", "in_progress"] };
  }
  if (params.priority) where.priority = params.priority;
  if (params.category) where.category = params.category;

  if (params.fromDate || params.toDate) {
    const createdAt: Record<string, Date> = {};
    if (params.fromDate) createdAt.gte = new Date(params.fromDate);
    if (params.toDate) createdAt.lte = new Date(params.toDate);
    where.created_at = createdAt;
  }

  if (params.search) {
    const q = params.search.trim();
    where.OR = [
      { ticket_no: { contains: q, mode: "insensitive" } },
      { customer_name: { contains: q, mode: "insensitive" } },
      { customer_phone: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
    ];
  }

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, params.page ?? 1);
  const skip = (page - 1) * take;

  const [total, tickets] = await Promise.all([
    prisma.support_tickets.count({ where }),
    prisma.support_tickets.findMany({
      where,
      include: TICKET_INCLUDE,
      orderBy: { created_at: params.sortDir === "asc" ? "asc" : "desc" },
      skip,
      take,
    }),
  ]);

  const vendorByCreator = await resolveVendorsByCreators(
    tickets.map((t) => t.created_by).filter((x): x is string => !!x),
  );

  return {
    data: tickets.map((t) => {
      const vendor = t.created_by ? vendorByCreator.get(t.created_by) : undefined;
      return {
        ...mapTicket(t),
        vendorName: vendor?.name || "",
        vendorPhone: vendor?.phone || "",
      };
    }),
    meta: {
      page,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
  };
}

async function findAccessibleTicket(actor: Actor, id: string) {
  const ticket = await prisma.support_tickets.findFirst({
    where: await scopeWhere(actor, { id }),
    include: TICKET_INCLUDE,
  });
  if (!ticket) throw new AppError(404, "Ticket not found");
  return ticket;
}

// The vendor behind a ticket, resolved from its creator. A ticket is raised
// either by a vendor owner (users -> vendors.user_id) or a vendor's staff
// member (users -> vendor_staff.user_id -> vendors). Admins see this on the
// ticket detail page to know which client the issue belongs to.
async function resolveTicketVendor(createdBy: string | null) {
  if (!createdBy) return null;

  let vendor = await prisma.vendors.findFirst({
    where: { user_id: createdBy, deleted_at: null },
    include: { locations: true },
  });

  if (!vendor) {
    const staff = await prisma.vendor_staff.findFirst({
      where: { user_id: createdBy, deleted_at: null },
      select: { vendor_id: true },
    });
    if (staff) {
      vendor = await prisma.vendors.findFirst({
        where: { id: staff.vendor_id, deleted_at: null },
        include: { locations: true },
      });
    }
  }

  if (!vendor) return null;

  return {
    id: vendor.id,
    name: vendor.business_name || vendor.client_name,
    contactName: vendor.client_name,
    phone: vendor.phone,
    email: vendor.email || "",
    address: vendor.address || "",
    location: vendor.locations?.name || "",
  };
}

async function buildTicketDetail(ticket: Awaited<ReturnType<typeof findAccessibleTicket>>) {
  const [replies, vendor] = await Promise.all([
    prisma.ticket_replies.findMany({
      where: { ticket_id: ticket.id },
      orderBy: { created_at: "asc" },
    }),
    resolveTicketVendor(ticket.created_by),
  ]);

  return {
    ...mapTicket(ticket),
    vendor,
    thread: replies.map((reply) => ({
      id: reply.id,
      message: reply.message,
      author: reply.author_name,
      createdAt: reply.created_at.toISOString(),
    })),
  };
}

export async function getTicketById(actor: Actor, id: string) {
  const ticket = await findAccessibleTicket(actor, id);
  return buildTicketDetail(ticket);
}

// Any reply keeps (or brings) the ticket in the "open" state; it only leaves
// open when a staff member explicitly resolves & closes it.
export async function addTicketReply(actor: Actor, id: string, message: string) {
  if (!message?.trim()) throw new AppError(400, "Message is required");
  const ticket = await findAccessibleTicket(actor, id);

  const user = await prisma.users.findUnique({
    where: { id: actor.id },
    select: { full_name: true },
  });

  const newStatus: TicketStatus = "open";
  await prisma.$transaction([
    prisma.ticket_replies.create({
      data: {
        ticket_id: id,
        author_id: actor.id,
        author_name: user?.full_name || "Unknown",
        message: message.trim(),
      },
    }),
    prisma.support_tickets.update({
      where: { id },
      data: { status: newStatus, updated_at: new Date() },
    }),
  ]);

  // Notify admins when a vendor or rider adds a remark to an existing ticket.
  // Staff (admin/super_admin) replies do not trigger notifications.
  const isVendorActor = actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
  const isRiderActor = actor.roles.includes("rider");
  if (isVendorActor || isRiderActor) {
    const actorLabel = isRiderActor ? "Rider" : "Vendor";
    const snippet = message.trim().length > 200 ? `${message.trim().slice(0, 200)}…` : message.trim();
    await notifyAdmins(
      `${actorLabel} Added a Remark: ${ticket.ticket_no}`,
      snippet,
      ticket.id,
      "ticket_reply",
      `/tickets/${ticket.id}`,
    );
  }

  // Notify the ticket creator when an admin or rider adds a reply.
  // Vendor/staff replies already notify admins above; this covers the reverse.
  if (isStaff(actor) || isRiderActor) {
    const creatorId = ticket.created_by;
    if (creatorId && creatorId !== actor.id) {
      const snippet = message.trim().length > 200 ? `${message.trim().slice(0, 200)}…` : message.trim();
      const actorLabel = isRiderActor ? "Rider" : "Admin";
      await createNotification(
        creatorId,
        `${actorLabel} Added a Remark: ${ticket.ticket_no}`,
        snippet,
        ticket.id,
        "ticket_reply",
        `/tickets/${ticket.id}`,
      );
    }
  }

  // Access was already verified above and only `status` changed by this
  // call - reuse the fetched ticket instead of re-querying it.
  return buildTicketDetail({ ...ticket, status: newStatus });
}

export async function setTicketStatus(actor: Actor, id: string, status: TicketStatus) {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw new AppError(400, "Invalid ticket status");
  }
  const existing = await findAccessibleTicket(actor, id);

  const ticket = await prisma.support_tickets.update({
    where: { id },
    data: {
      status,
      closed_at: status === "closed" ? new Date() : null,
      updated_at: new Date(),
    },
    include: TICKET_INCLUDE,
  });

  // Notify the ticket creator when the status changes (unless they changed it
  // themselves). Status labels map to human-readable text for the notification.
  const STATUS_LABELS: Record<string, string> = {
    pending: "Pending",
    open: "Opened",
    closed: "Resolved",
  };
  const creatorId = existing.created_by;
  if (creatorId && creatorId !== actor.id && existing.status !== status) {
    const label = STATUS_LABELS[status] || status;
    await createNotification(
      creatorId,
      `Ticket ${label}: ${ticket.ticket_no}`,
      ticket.subject || `Status changed to ${label}`,
      ticket.id,
      "ticket_status",
      `/tickets/${ticket.id}`,
    ).catch(() => {});
  }

  return mapTicket(ticket);
}
