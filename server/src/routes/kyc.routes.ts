import { Router } from "express";
import {
  approveKycController,
  getKycController,
  listKycController,
  rejectKycController,
  submitKycController,
} from "../controllers/kyc.controller";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { kycUpload } from "../lib/kycUpload";

const kycSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many KYC submissions. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("kyc_submit"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

const kycRouter: Router = Router();

// Public — anyone can submit a KYC application (multipart/form-data for file uploads)
kycRouter.post("/apply", kycSubmitLimiter, kycUpload, submitKycController);

// Protected — super admins only
kycRouter.get("/applications", authMiddleware, listKycController);
kycRouter.get("/applications/:id", authMiddleware, getKycController);
kycRouter.patch("/applications/:id/approve", authMiddleware, csrfProtection, approveKycController);
kycRouter.patch("/applications/:id/reject", authMiddleware, csrfProtection, rejectKycController);

export default kycRouter;
