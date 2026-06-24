import { Request, Response } from "express";
import { createTicket, listTickets } from "../services/ticket.service";
import { ListTicketsParams, TicketStatus } from "../types/ticket.type";

export async function listTicketsController(req: Request, res: Response) {
  try {
    const { status, search, priority, category, fromDate, toDate } = req.query;

    const params: ListTicketsParams = {};
    if (typeof status === "string") params.status = status as TicketStatus;
    if (typeof search === "string") params.search = search;
    if (typeof priority === "string") params.priority = priority;
    if (typeof category === "string") params.category = category;
    if (typeof fromDate === "string") params.fromDate = fromDate;
    if (typeof toDate === "string") params.toDate = toDate;

    const tickets = await listTickets(params);

    return res.status(200).json({ success: true, data: tickets });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load tickets",
    });
  }
}

export async function createTicketController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { subject } = req.body;
    if (typeof subject !== "string" || !subject.trim()) {
      return res.status(400).json({ success: false, message: "subject is required" });
    }

    const ticket = await createTicket(
      { id: req.user.id, roles: req.user.roles },
      req.body,
    );

    return res.status(201).json({
      success: true,
      message: "Ticket created",
      data: ticket,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create ticket",
    });
  }
}
