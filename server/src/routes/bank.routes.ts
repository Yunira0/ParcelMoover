import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { createBankSchema, updateBankSchema } from "../validators/bank.schema";
import { listBanksController, createBankController, updateBankController } from "../controllers/bank.controller";

const bankRouter: Router = Router();

const limiter = (name: string, max: number) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    message: { success: false, message: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    validate: false,
    store: createRedisRateLimitStore(name),
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
  });

const readLimiter = limiter("bank-read", 120);
const writeLimiter = limiter("bank-write", 30);

// GET /api/banks - the list behind every bank-name picker. Vendors fill in
// their own KYC form, so vendor roles may read it too.
bankRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "accountant", "sales", "vendor", "vendor_staff"),
  readLimiter,
  listBanksController,
);

// POST /api/banks - add a bank (super admin only).
bankRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  validate(createBankSchema),
  createBankController,
);

// PATCH /api/banks/:id - change a bank's code, or enable/disable it (super admin only).
bankRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
  validate(updateBankSchema),
  updateBankController,
);

export default bankRouter;
