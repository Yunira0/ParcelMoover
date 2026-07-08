import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { getCurrentUserController, updateCurrentUserController } from "../controllers/me.controller";

const meRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown");

const meReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("me-read"),
  keyGenerator: actorOrIpKey,
});

const meWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("me-write"),
  keyGenerator: actorOrIpKey,
});

meRouter.get("/", authMiddleware, meReadLimiter, getCurrentUserController);
meRouter.patch("/", authMiddleware, csrfProtection, meWriteLimiter, updateCurrentUserController);

export default meRouter;
