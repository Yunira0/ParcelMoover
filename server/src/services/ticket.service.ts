import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { getDatePart, randomBase32 } from "../utils/trackingId";
import { CreateTicketInput, ListTicketsParams, TicketStatus } from "../types/ticket.type";
import { createNotification } from "./notification.service";

type Actor = { id: string; roles: string[] };

const VALID_STATUSES: TicketStatus[] = ["open", "in_progress", "pending", "resolved", "closed"];

function generateTicketNo(date = new Date()) {
  return `TKT-${getDatePart(date)}-${randomBase32(6)}`;
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
    status: ticket.status === "open" ? "pending" : ticket.status,
    assignedTo: ticket.users_support_tickets_assigned_toTousers?.full_name || "Unassigned",
    createdAt: ticket.created_at.toISOString().slice(0, 10),
  };
}

const TICKET_INCLUDE = {
  users_support_tickets_assigned_toTousers: true,
} as const;

export async function createTicket(actor: Actor, input: CreateTicketInput) {
  if (!input.subject?.trim()) {
    throw new AppError(400, "Subject is required");
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    throw new AppError(400, "Invalid ticket status");
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
      status: input.status || "pending",
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

export async function listTickets(params: ListTicketsParams = {}) {
  const where: Record<string, unknown> = {};

  if (params.status && VALID_STATUSES.includes(params.status)) {
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

  const tickets = await prisma.support_tickets.findMany({
    where,
    include: TICKET_INCLUDE,
    orderBy: { created_at: "desc" },
  });

  return tickets.map(mapTicket);
}
