import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  createTicketController,
  getTicketByIdController,
  listTicketsController,
  replyTicketController,
  setTicketStatusController,
} from "../controllers/ticket.controller";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const ticketRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const ticketsReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("tickets-read"),
  keyGenerator: actorOrIpKey,
});

const createTicketLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { success: false, message: "Too many tickets created, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("tickets-create"),
  keyGenerator: actorOrIpKey,
});

// Vendors create + view their own tickets; admins see and manage all (scoped in the service).
const CX_ROLES = ["super_admin", "admin", "vendor"] as const;

// GET /api/tickets — list tickets (status/priority/category/date filters; vendor-scoped)
ticketRouter.get(
  "/",
  authMiddleware,
  authorizeRoles(...CX_ROLES),
  ticketsReadLimiter,
  listTicketsController,
);

// GET /api/tickets/:id — ticket detail + reply thread (viewing a pending ticket sets it Open)
ticketRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles(...CX_ROLES),
  ticketsReadLimiter,
  getTicketByIdController,
);

// POST /api/tickets — create a new ticket
ticketRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...CX_ROLES),
  createTicketLimiter,
  createTicketController,
);

// POST /api/tickets/:id/reply — reply (resolves the ticket -> Closed)
ticketRouter.post(
  "/:id/reply",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...CX_ROLES),
  replyTicketController,
);

// PATCH /api/tickets/:id/status — set Open / Pending / Closed (e.g. Mark as Done)
ticketRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...CX_ROLES),
  setTicketStatusController,
);

export default ticketRouter;
