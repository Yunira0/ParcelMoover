import { Request, Response } from "express";
import {
  addTicketReply,
  createTicket,
  getTicketById,
  listTickets,
} from "../../services/ticket.service";
import { CreateTicketInput, ListTicketsParams } from "../../types/ticket.type";
import { withIdempotency } from "../../services/idempotency.service";
import { ListTicketsQuery } from "../../validators/ticket.schema";
import { PublicCreateTicketInput, PublicTicketReplyInput } from "../../validators/publicApi.schema";
import { actorFrom, sendError, UUID_REGEX } from "./shared";

export async function publicCreateTicketController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key header is required",
      });
    }
    if (!UUID_REGEX.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key must be a valid UUID",
      });
    }

    const actor = actorFrom(req);
    const input = req.body as PublicCreateTicketInput;

    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const ticket = await createTicket(actor, input as CreateTicketInput);

      const body = {
        success: true,
        message: "Ticket created",
        data: ticket,
      };

      return {
        result: body,
        response: { statusCode: 201, body, resourceID: ticket.id },
      };
    });

    return res.status(201).json(responseBody);
  } catch (error: any) {
    return sendError(res, error, "Failed to create ticket");
  }
}

export async function publicListTicketsController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const query = req.query as unknown as ListTicketsQuery;
    const params: ListTicketsParams = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.toDate ? { toDate: query.toDate } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    };

    const { data, meta } = await listTickets(actorFrom(req), params);

    return res.status(200).json({ success: true, data, meta });
  } catch (error: any) {
    return sendError(res, error, "Failed to load tickets");
  }
}

export async function publicGetTicketController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }
    const ticket = await getTicketById(actorFrom(req), id);

    return res.status(200).json({ success: true, data: ticket });
  } catch (error: any) {
    return sendError(res, error, "Failed to load ticket");
  }
}

export async function publicAddTicketReplyController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key header is required",
      });
    }
    if (!UUID_REGEX.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key must be a valid UUID",
      });
    }

    const actor = actorFrom(req);
    const { message } = req.body as PublicTicketReplyInput;

    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const ticket = await addTicketReply(actor, id, message);

      const body = {
        success: true,
        message: "Reply posted",
        data: ticket,
      };

      return {
        result: body,
        response: { statusCode: 201, body, resourceID: id },
      };
    });

    return res.status(201).json(responseBody);
  } catch (error: any) {
    return sendError(res, error, "Failed to post reply");
  }
}
