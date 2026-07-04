import { Request, Response } from "express";
import {
  addTicketReply,
  createTicket,
  getTicketById,
  listTickets,
  setTicketStatus,
} from "../services/ticket.service";
import { ListTicketsParams, TicketStatus, TicketWorkflowStatus } from "../types/ticket.type";

export async function listTicketsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { status, search, priority, category, fromDate, toDate, page, pageSize, sortDir } = req.query;

    const params: ListTicketsParams = {};
    if (typeof status === "string") params.status = status as TicketStatus;
    if (typeof search === "string") params.search = search;
    if (typeof priority === "string") params.priority = priority;
    if (typeof category === "string") params.category = category;
    if (typeof fromDate === "string") params.fromDate = fromDate;
    if (typeof toDate === "string") params.toDate = toDate;
    if (typeof page === "string" && Number.isFinite(Number(page))) params.page = Number(page);
    if (typeof pageSize === "string" && Number.isFinite(Number(pageSize))) params.pageSize = Number(pageSize);
    if (sortDir === "asc" || sortDir === "desc") params.sortDir = sortDir;

    const { data, meta } = await listTickets({ id: req.user.id, roles: req.user.roles }, params);

    return res.status(200).json({ success: true, data, meta });
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

export async function getTicketByIdController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }
    const ticket = await getTicketById({ id: req.user.id, roles: req.user.roles }, id);
    return res.status(200).json({ success: true, data: ticket });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load ticket",
    });
  }
}

export async function replyTicketController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    const { message } = req.body;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ success: false, message: "message is required" });
    }
    const ticket = await addTicketReply({ id: req.user.id, roles: req.user.roles }, id, message);
    return res.status(201).json({ success: true, message: "Reply posted", data: ticket });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to post reply",
    });
  }
}

export async function setTicketStatusController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    const { status } = req.body;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }
    if (status !== "open" && status !== "pending" && status !== "closed") {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const ticket = await setTicketStatus(
      { id: req.user.id, roles: req.user.roles },
      id,
      status as TicketWorkflowStatus,
    );
    return res.status(200).json({ success: true, message: "Status updated", data: ticket });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update status",
    });
  }
}
