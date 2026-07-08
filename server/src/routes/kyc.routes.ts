import { Request, Router } from "express";
import {
  approveKycController,
  getKycController,
  listKycController,
  rejectKycController,
  submitKycController,
} from "../controllers/kyc.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { kycUpload } from "../lib/kycUpload";

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown");

const kycSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many KYC submissions. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("kyc_submit"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

// Approve/reject create user accounts and vendor records - cap how fast a
// single reviewer can churn through applications, matching the rate limiting
// applied to every other write route in the app.
const kycReviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many KYC review actions, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("kyc-review"),
  keyGenerator: actorOrIpKey,
});

const kycRouter: Router = Router();

// Public — anyone can submit a KYC application (multipart/form-data for file uploads)
kycRouter.post("/apply", kycSubmitLimiter, kycUpload, submitKycController);

// Protected — super admins only
kycRouter.get("/applications", authMiddleware, authorizeRoles("super_admin"), listKycController);
kycRouter.get("/applications/:id", authMiddleware, authorizeRoles("super_admin"), getKycController);
kycRouter.patch(
  "/applications/:id/approve",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  kycReviewLimiter,
  approveKycController,
);
kycRouter.patch(
  "/applications/:id/reject",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  kycReviewLimiter,
  rejectKycController,
);

export default kycRouter;
