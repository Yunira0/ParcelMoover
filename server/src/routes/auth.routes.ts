import { Router, Request, Response } from "express";
import {
  changePasswordController,
  getAdminsController,
  getLocationsController,
  getRidersController,
  getVendorsController,
  getManagedUserController,
  login,
  logoutController,
  registerUserController,
  updateManagedUserController,
  updateManagedUserPasswordController,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  loginSchema,
  registerUserSchema,
  updateManagedUserSchema,
  updatePasswordSchema,
} from "../validators/auth.schema";
import rateLimit, {ipKeyGenerator} from "express-rate-limit";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { sendWelcomeEmail } from "../lib/mailer";
import { registrationUpload } from "../lib/registrationUpload";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many login attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("login"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown")
});

const authRouter: Router = Router();

authRouter.post("/login", loginLimiter, validate(loginSchema), login);
authRouter.post("/logout", authMiddleware, csrfProtection, logoutController);
authRouter.post("/change-password", authMiddleware, csrfProtection, changePasswordController);

// Dev-only: POST /auth/test-email  { "to": "someone@example.com" }
// Gated on NODE_ENV so it never registers in production, and further
// requires an authenticated admin so it can't be used as an open mail
// relay / error-message oracle if a non-production deployment is
// reachable over the network.
if (process.env.NODE_ENV === "development") {
  authRouter.post(
    "/test-email",
    authMiddleware,
    authorizeRoles("super_admin", "admin"),
    async (req: Request, res: Response) => {
      const to = req.body?.to as string;
      if (!to) return res.status(400).json({ success: false, message: "to is required" });
      try {
        await sendWelcomeEmail({ to, name: "Test User", password: "TempPass123!" });
        return res.json({ success: true, message: `Test email sent to ${to}` });
      } catch (err: any) {
        console.error("[test-email]", err);
        return res.status(500).json({ success: false, message: "Failed to send test email" });
      }
    },
  );
}
authRouter.post(
  "/users/register",
  authMiddleware,
  csrfProtection,
  registrationUpload,
  validate(registerUserSchema),
  registerUserController,
);
authRouter.get("/users/admins", authMiddleware, getAdminsController);
authRouter.get("/users/vendors", authMiddleware, getVendorsController);
authRouter.get("/users/riders", authMiddleware, getRidersController);
authRouter.get("/users/:type/:id", authMiddleware, getManagedUserController);
authRouter.patch(
  "/users/:type/:id",
  authMiddleware,
  csrfProtection,
  validate(updateManagedUserSchema),
  updateManagedUserController,
);
authRouter.patch(
  "/users/:type/:id/password",
  authMiddleware,
  csrfProtection,
  validate(updatePasswordSchema),
  updateManagedUserPasswordController,
);
authRouter.get("/locations", authMiddleware, getLocationsController);

export default authRouter;
