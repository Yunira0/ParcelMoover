import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  createLocationController,
  listManagedLocationsController,
  updateLocationController,
} from "../controllers/location.controller";

const locationRouter: Router = Router();

// GET /api/locations — destinations with their nested covered areas (Settings screen)
locationRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  listManagedLocationsController,
);

// POST /api/locations — create a destination or a covered area (parentId set)
locationRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  createLocationController,
);

// PATCH /api/locations/:id — edit a destination/area or toggle its active state
locationRouter.patch(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  updateLocationController,
);

export default locationRouter;
