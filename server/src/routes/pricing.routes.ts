import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireStaffPermission } from "../middlewares/staffPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  getPricingSettingsController,
  updatePricingSettingsController,
  getVendorQuoteController,
} from "../controllers/pricing.controller";

const pricingRouter: Router = Router();

// GET /api/pricing/settings — zone + flat (valley) rate config. Readable by
// everyone who can create a vendor, so the form can prefill the default rates.
pricingRouter.get(
  "/settings",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "sales"),
  getPricingSettingsController,
);

// PUT /api/pricing/settings — update zone/flat rates (super admin only)
pricingRouter.put(
  "/settings",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  updatePricingSettingsController,
);

// GET /api/pricing/quote — vendor-aware delivery charge for a destination.
// Part of the order-creation flow, so gated by ORDER_ACCESS (not a finance/rate permission).
pricingRouter.get(
  "/quote",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor", "vendor_staff"),
  requireStaffPermission("ORDER_ACCESS"),
  getVendorQuoteController,
);

export default pricingRouter;
