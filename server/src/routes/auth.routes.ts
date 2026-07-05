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
  updateAdminPermissionsController,
  updateManagedUserController,
  updateManagedUserPasswordController,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  loginSchema,
  registerUserSchema,
  updateAdminPermissionsSchema,
  updateManagedUserSchema,
  updatePasswordSchema,
} from "../validators/auth.schema";
import rateLimit, {ipKeyGenerator} from "express-rate-limit";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { sendWelcomeEmail } from "../lib/mailer";
import { registrationUpload } from "../lib/registrationUpload";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: "Too many login attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("login"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown")
});

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown");

// Covers the user listing/detail GET endpoints — previously the only
// unlimited routes in this file, which made the IDOR-prone /users/:type/:id
// lookup trivially scriptable to scrape every account in the system.
const authReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("auth-read"),
  keyGenerator: actorOrIpKey,
});

// Covers profile/password mutations and registration.
const authWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("auth-write"),
  keyGenerator: actorOrIpKey,
});

const authRouter: Router = Router();

authRouter.post("/login", loginLimiter, validate(loginSchema), login);
authRouter.post("/logout", authMiddleware, csrfProtection, logoutController);
authRouter.post("/change-password", authMiddleware, csrfProtection, authWriteLimiter, changePasswordController);

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
  authWriteLimiter,
  registrationUpload,
  validate(registerUserSchema),
  registerUserController,
);
authRouter.get(
  "/users/admins",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  authReadLimiter,
  getAdminsController,
);
authRouter.get(
  "/users/vendors",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "sales", "vendor", "vendor_staff"),
  authReadLimiter,
  getVendorsController,
);
authRouter.get(
  "/users/riders",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  authReadLimiter,
  getRidersController,
);
authRouter.get("/users/:type/:id", authMiddleware, authReadLimiter, getManagedUserController);
authRouter.patch(
  "/users/:type/:id",
  authMiddleware,
  csrfProtection,
  authWriteLimiter,
  validate(updateManagedUserSchema),
  updateManagedUserController,
);
authRouter.patch(
  "/users/:type/:id/password",
  authMiddleware,
  csrfProtection,
  authWriteLimiter,
  validate(updatePasswordSchema),
  updateManagedUserPasswordController,
);
// Super-admin only: delegate MANAGE_USERS / SETTINGS_ACCESS to an admin account.
authRouter.patch(
  "/users/admins/:id/permissions",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  authWriteLimiter,
  validate(updateAdminPermissionsSchema),
  updateAdminPermissionsController,
);
authRouter.get("/locations", authMiddleware, authReadLimiter, getLocationsController);

export default authRouter;
