import { Router, Request, Response } from "express";
import {
  changePasswordController,
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
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { sendWelcomeEmail } from "../lib/mailer";

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
authRouter.post("/change-password", authMiddleware, csrfProtection, changePasswordController);

// Dev-only: POST /auth/test-email  { "to": "someone@example.com" }
if (process.env.NODE_ENV !== "production") {
  authRouter.post("/test-email", async (req: Request, res: Response) => {
    const to = req.body?.to as string;
    if (!to) return res.status(400).json({ success: false, message: "to is required" });
    try {
      await sendWelcomeEmail({ to, name: "Test User", password: "TempPass123!" });
      return res.json({ success: true, message: `Test email sent to ${to}` });
    } catch (err: any) {
      console.error("[test-email]", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });
}
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
