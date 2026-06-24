import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.mddleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { getRemarkByIdController, listRemarksController } from "../controllers/remark.controller";

const remarkRouter: Router = Router();

// GET /api/remarks — list parcel remarks added across the app (with optional status/date/search filters)
remarkRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  listRemarksController,
);

// GET /api/remarks/:id — single remark + its full per-parcel conversation thread
remarkRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  getRemarkByIdController,
);

export default remarkRouter;
