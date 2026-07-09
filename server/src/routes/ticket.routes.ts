import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createTicketSchema, listTicketsQuerySchema } from "../validators/ticket.schema";
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
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("tickets-read"),
  keyGenerator: actorOrIpKey,
});

const createTicketLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many tickets created, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("tickets-create"),
  keyGenerator: actorOrIpKey,
});

const ticketsWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("tickets-write"),
  keyGenerator: actorOrIpKey,
});

// Vendors/staff create + view their own tickets; admins see and manage all (scoped in the service).
// Sales can view/respond to their clients' tickets but not open new ones.
const CX_ROLES = ["super_admin", "admin", "vendor", "vendor_staff", "sales"] as const;
const CREATE_ROLES = ["super_admin", "admin", "vendor", "vendor_staff"] as const;

// GET /api/tickets — list tickets (status/priority/category/date filters; vendor-scoped)
ticketRouter.get(
  "/",
  authMiddleware,
  authorizeRoles(...CX_ROLES),
  ticketsReadLimiter,
  validate(listTicketsQuerySchema, "query"),
  listTicketsController,
);

// GET /api/tickets/:id — ticket detail + reply thread
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
  authorizeRoles(...CREATE_ROLES),
  createTicketLimiter,
  validate(createTicketSchema),
  createTicketController,
);

// POST /api/tickets/:id/reply — add a reply (staff→pending, vendor→open)
ticketRouter.post(
  "/:id/reply",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...CX_ROLES),
  ticketsWriteLimiter,
  replyTicketController,
);

// PATCH /api/tickets/:id/status — set Open / Pending / Closed (e.g. Mark as Done)
ticketRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles(...CX_ROLES),
  ticketsWriteLimiter,
  setTicketStatusController,
);

export default ticketRouter;
