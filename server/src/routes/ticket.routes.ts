import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  createTicketController,
  listTicketsController,
} from "../controllers/ticket.controller";

const ticketRouter: Router = Router();

// GET /api/tickets — list CX tickets (with optional status/priority/category/date filters)
ticketRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  listTicketsController,
);

// POST /api/tickets — create a new ticket
ticketRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  createTicketController,
);

export default ticketRouter;
