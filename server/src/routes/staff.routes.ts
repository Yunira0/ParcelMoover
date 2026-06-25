import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import {
  createStaffController,
  listStaffController,
  setStaffEnabledController,
  updateStaffController,
} from "../controllers/staff.controller";

const staffRouter: Router = Router();

// All staff endpoints are vendor-owned.
staffRouter.get("/", authMiddleware, authorizeRoles("vendor"), listStaffController);

staffRouter.post("/", authMiddleware, csrfProtection, authorizeRoles("vendor"), createStaffController);

staffRouter.patch("/:id", authMiddleware, csrfProtection, authorizeRoles("vendor"), updateStaffController);

staffRouter.patch(
  "/:id/status",
  authMiddleware,
  csrfProtection,
  authorizeRoles("vendor"),
  setStaffEnabledController,
);

export default staffRouter;
