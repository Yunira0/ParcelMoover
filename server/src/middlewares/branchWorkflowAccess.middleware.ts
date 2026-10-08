import { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma";
import { hasOfficeFinanceAuthority } from "../utils/financeRoles";

/**
 * Lets a branch's assigned admin use the branch settlement and billing
 * workflow without granting them cross-branch tracking. Cross-branch reports
 * and office payment review remain behind BRANCH_TRACKING_* permissions.
 */
export async function requireBranchWorkflowAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized access" });
  }

  // The office accountant settles every branch's COD, like super_admin.
  if (hasOfficeFinanceAuthority(req.user)) return next();

  const admin = await prisma.admins.findUnique({
    where: { user_id: req.user.id },
    select: { location_id: true, permissions: true },
  });
  const canTrackOtherBranches = Boolean(admin?.permissions.some(
    (permission) => permission === "BRANCH_TRACKING_READ" || permission === "BRANCH_TRACKING_WRITE",
  ));

  if (!admin?.location_id && !canTrackOtherBranches) {
    return res.status(403).json({
      success: false,
      message: "Assign this admin to a branch before using branch settlements and billing",
    });
  }

  next();
}
