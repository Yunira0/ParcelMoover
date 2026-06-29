import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createTicketSchema, listTicketsQuerySchema } from "../validators/ticket.schema";
import {
  createTicketController,
  listTicketsController,
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

// GET /api/tickets — list CX tickets (with optional status/priority/category/date filters)
ticketRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  ticketsReadLimiter,
  validate(listTicketsQuerySchema, "query"),
  listTicketsController,
);

// POST /api/tickets — create a new ticket
ticketRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  createTicketLimiter,
  validate(createTicketSchema),
  createTicketController,
);

export default ticketRouter;
