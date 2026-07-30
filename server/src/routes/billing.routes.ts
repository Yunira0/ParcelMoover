import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { paymentProofUpload, paymentQrUpload } from "../lib/billingUpload";
import {
  getBillingSettingsController,
  getBillingStatusController,
  listVendorBalancesController,
  listVendorPaymentsController,
  reviewVendorPaymentController,
  submitVendorPaymentController,
  updateBillingSettingsController,
  uploadPaymentQrController,
} from "../controllers/billing.controller";

const billingRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const billingReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open (skip limiting), not 500, if Redis is unreachable mid-request.
  passOnStoreError: true,
  store: createRedisRateLimitStore("billing-read"),
  keyGenerator: actorOrIpKey,
});

// Claims are cheap to file and expensive to review. Cap how fast one account
// can flood the verification queue.
const paymentSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many payment submissions. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("billing-payment-submit"),
  keyGenerator: actorOrIpKey,
});

const billingWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many billing actions, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("billing-write"),
  keyGenerator: actorOrIpKey,
});

// GET /api/billing/status — account balance, thresholds, and current state.
// A vendor always sees their own; staff/sales must name a vendorId.
billingRouter.get(
  "/status",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff", "sales"),
  requireStaffPermission("FINANCE_ACCESS"),
  billingReadLimiter,
  getBillingStatusController,
);

// GET /api/billing/payments — own claim history (vendor) or the review queue (admin)
billingRouter.get(
  "/payments",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("FINANCE_ACCESS"),
  billingReadLimiter,
  listVendorPaymentsController,
);

// POST /api/billing/payments — vendor files a payment claim (multipart: optional proof)
billingRouter.post(
  "/payments",
  authMiddleware,
  csrfProtection,
  authorizeRoles("vendor", "vendor_staff"),
  requireStaffPermission("FINANCE_ACCESS"),
  paymentSubmitLimiter,
  paymentProofUpload,
  submitVendorPaymentController,
);

// PATCH /api/billing/payments/:id/review — admin verifies or rejects a claim.
// Verification is the only thing that credits a vendor's balance.
billingRouter.patch(
  "/payments/:id/review",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  billingWriteLimiter,
  reviewVendorPaymentController,
);

// GET /api/billing/settings — global thresholds and the Fonepay QR
billingRouter.get(
  "/settings",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  billingReadLimiter,
  getBillingSettingsController,
);

// PATCH /api/billing/settings — super_admin only; these thresholds decide who
// can trade.
billingRouter.patch(
  "/settings",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  billingWriteLimiter,
  updateBillingSettingsController,
);

// POST /api/billing/settings/qr — replace the QR every vendor is told to pay to
billingRouter.post(
  "/settings/qr",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  billingWriteLimiter,
  paymentQrUpload,
  uploadPaymentQrController,
);

// GET /api/billing/vendors — every vendor's balance and state. Also the
// pre-enforcement rollout report: who would be blocked if this went live now.
billingRouter.get(
  "/vendors",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  billingReadLimiter,
  listVendorBalancesController,
);

export default billingRouter;
