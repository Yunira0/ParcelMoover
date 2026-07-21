import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  getActivePickupTimeSlotsController,
  getAllPickupTimeSlotsController,
  createPickupTimeSlotController,
  updatePickupTimeSlotController,
  deletePickupTimeSlotController,
} from "../controllers/pickupTimeSlots.controller";

const pickupTimeSlotsRouter: Router = Router();

// Same roles allowed to create pickup tickets — they need to read the slot list.
const TICKET_CREATE_ROLES = ["super_admin", "admin", "vendor", "vendor_staff"];

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("pickup-slots-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("pickup-slots-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// GET /api/pickup-time-slots — active slots, for the ticket-creation form.
pickupTimeSlotsRouter.get(
  "/",
  authMiddleware,
  authorizeRoles(...TICKET_CREATE_ROLES),
  readLimiter,
  getActivePickupTimeSlotsController,
);

// GET /api/pickup-time-slots/admin — all slots incl. inactive (super admin only).
pickupTimeSlotsRouter.get(
  "/admin",
  authMiddleware,
  authorizeRoles("super_admin"),
  readLimiter,
  getAllPickupTimeSlotsController,
);

pickupTimeSlotsRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  createPickupTimeSlotController,
);

pickupTimeSlotsRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  updatePickupTimeSlotController,
);

pickupTimeSlotsRouter.delete(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  deletePickupTimeSlotController,
);

export default pickupTimeSlotsRouter;
