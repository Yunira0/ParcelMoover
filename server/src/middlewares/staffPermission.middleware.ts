import { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma";
import { StaffPermission } from "../types/staff.type";

/**
 * Enforces a vendor_staff account's granted permission for a route. Vendor
 * owners and every other role pass through untouched - this only applies to
 * actors carrying the vendor_staff role, so the permissions a vendor grants
 * via StaffFormPage become a real authorization boundary instead of just
 * hiding sidebar links on the client.
 */
export function requireStaffPermission(permission: StaffPermission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    if (!req.user.roles.includes("vendor_staff")) {
      return next();
    }

    const staffRecord = await prisma.vendor_staff.findFirst({
      where: { user_id: req.user.id, deleted_at: null, enabled: true },
      select: { permissions: true },
    });

    if (!staffRecord) {
      return res.status(403).json({ success: false, message: "Staff profile not found or inactive" });
    }

    if (!(staffRecord.permissions as string[]).includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: this account does not have '${permission}' access`,
      });
    }

    next();
  };
}
