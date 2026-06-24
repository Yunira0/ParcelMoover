import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  getDeliveryQuoteController,
  listDeliveryRatesController,
  setDeliveryRateActiveController,
  upsertDeliveryRateController,
} from "../controllers/delivery-rate.controller";

const deliveryRateRouter: Router = Router();

// GET /api/delivery-rates/quote — used by the order form to auto-calculate the payable amount
deliveryRateRouter.get(
  "/quote",
  authMiddleware,
  authorizeRoles("super_admin", "admin", "vendor"),
  getDeliveryQuoteController,
);

// GET /api/delivery-rates — list all configured routes
deliveryRateRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  listDeliveryRatesController,
);

// POST /api/delivery-rates — create/update the rate for a route
deliveryRateRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  upsertDeliveryRateController,
);

// PATCH /api/delivery-rates/:id/active — enable/disable a route's rate
deliveryRateRouter.patch(
  "/:id/active",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  setDeliveryRateActiveController,
);

export default deliveryRateRouter;
