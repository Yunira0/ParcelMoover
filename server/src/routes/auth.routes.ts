import { Router } from "express";
import {
  getAdminsController,
  getLocationsController,
  getRidersController,
  getVendorsController,
  login,
  registerUserController,
  updateManagedUserController,
  updateManagedUserPasswordController,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import rateLimit, {ipKeyGenerator} from "express-rate-limit";
import crypto from "crypto"
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: "Too many login attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("login"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown")
});

const authRouter: Router = Router();



authRouter.post("/login", loginLimiter, login);
authRouter.post(
  "/users/register",
  authMiddleware,
  csrfProtection,
  registerUserController,
);
authRouter.get("/users/admins", authMiddleware, getAdminsController);
authRouter.get("/users/vendors", authMiddleware, getVendorsController);
authRouter.get("/users/riders", authMiddleware, getRidersController);
authRouter.patch("/users/:type/:id", authMiddleware, csrfProtection, updateManagedUserController);
authRouter.patch("/users/:type/:id/password", authMiddleware, csrfProtection, updateManagedUserPasswordController);
authRouter.get("/locations", authMiddleware, getLocationsController);

export default authRouter;
