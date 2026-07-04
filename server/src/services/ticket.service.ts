import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { getDatePart, randomBase32 } from "../utils/trackingId";
import { CreateTicketInput, ListTicketsParams, TicketStatus } from "../types/ticket.type";
import { createNotification } from "./notification.service";

type Actor = { id: string; roles: string[] };

// The workflow only uses these three; legacy values are normalized on read.
const WORKFLOW_STATUSES: TicketStatus[] = ["open", "pending", "closed"];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const isStaff = (actor: Actor) =>
  actor.roles.includes("admin") || actor.roles.includes("super_admin");

function generateTicketNo(date = new Date()) {
  return `TKT-${getDatePart(date)}-${randomBase32(6)}`;
}

// Map any stored status onto the open/pending/closed workflow.
function normalizeStatus(status: string): TicketStatus {
  if (status === "open" || status === "in_progress") return "open";
  if (status === "closed" || status === "resolved") return "closed";
  return "pending";
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

// Vendors can only touch tickets they created; staff (admin) can touch any;
// sales see tickets tied to parcels owned by one of their vendors (clients).
async function scopeWhere(actor: Actor, extra: Record<string, unknown> = {}) {
  if (isStaff(actor)) return extra;

  if (actor.roles.includes("sales")) {
    const owned = await prisma.vendors.findMany({
      where: { sales_user_id: actor.id, deleted_at: null },
      select: { id: true },
    });
    return { ...extra, parcels: { vendor_id: { in: owned.map((v) => v.id) } } };
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
      status: "open",
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
    );
  }

  return mapTicket(ticket);
}

export async function listTickets(actor: Actor, params: ListTicketsParams = {}) {
  const where: Record<string, unknown> = await scopeWhere(actor);

  if (params.status && WORKFLOW_STATUSES.includes(params.status)) {
    where.status = params.status;
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

  return {
    data: tickets.map(mapTicket),
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

export async function getTicketById(actor: Actor, id: string) {
  const ticket = await findAccessibleTicket(actor, id);

  const replies = await prisma.ticket_replies.findMany({
    where: { ticket_id: id },
    orderBy: { created_at: "asc" },
  });

  return {
    ...mapTicket(ticket),
    thread: replies.map((reply) => ({
      id: reply.id,
      message: reply.message,
      author: reply.author_name,
      createdAt: reply.created_at.toISOString(),
    })),
  };
}

// Staff reply → "pending" (waiting for vendor); vendor reply → "open" (needs staff attention).
export async function addTicketReply(actor: Actor, id: string, message: string) {
  if (!message?.trim()) throw new AppError(400, "Message is required");
  await findAccessibleTicket(actor, id);

  const user = await prisma.users.findUnique({
    where: { id: actor.id },
    select: { full_name: true },
  });

  await prisma.ticket_replies.create({
    data: {
      ticket_id: id,
      author_id: actor.id,
      author_name: user?.full_name || "Unknown",
      message: message.trim(),
    },
  });

  const newStatus = isStaff(actor) ? "pending" : "open";
  await prisma.support_tickets.update({
    where: { id },
    data: { status: newStatus, updated_at: new Date() },
  });

  return getTicketById(actor, id);
}

export async function setTicketStatus(actor: Actor, id: string, status: TicketStatus) {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw new AppError(400, "Invalid ticket status");
  }
  await findAccessibleTicket(actor, id);

  const ticket = await prisma.support_tickets.update({
    where: { id },
    data: {
      status,
      closed_at: status === "closed" ? new Date() : null,
      updated_at: new Date(),
    },
    include: TICKET_INCLUDE,
  });

  return mapTicket(ticket);
}
