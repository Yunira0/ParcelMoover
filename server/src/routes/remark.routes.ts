import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { validate } from "../middlewares/validate.middleware";
import { listRemarksQuerySchema } from "../validators/remark.schema";
import { uuidParamSchema } from "../validators/common";
import { getRemarkByIdController, listRemarksController } from "../controllers/remark.controller";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const remarkRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const remarksReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("remarks-read"),
  keyGenerator: actorOrIpKey,
});

// GET /api/remarks — list parcel remarks added across the app (with optional status/date/search filters)
remarkRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  remarksReadLimiter,
  validate(listRemarksQuerySchema, "query"),
  listRemarksController,
);

// GET /api/remarks/:id — single remark + its full per-parcel conversation thread
remarkRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  remarksReadLimiter,
  validate(uuidParamSchema, "params"),
  getRemarkByIdController,
);

export default remarkRouter;
