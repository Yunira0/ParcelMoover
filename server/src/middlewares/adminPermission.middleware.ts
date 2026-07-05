import { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AdminPermission } from "../types/adminPermission.type";

/**
 * Enforces a delegated admin permission for a route. super_admin always
 * passes; an actor carrying the admin role must have been granted the
 * permission (admins.permissions) by a super_admin. Other roles pass through
 * untouched - route-level authorizeRoles still decides which roles get in at
 * all, this only narrows what a plain admin may do.
 */
export function requireAdminPermission(permission: AdminPermission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    if (req.user.roles.includes("super_admin") || !req.user.roles.includes("admin")) {
      return next();
    }

    const adminRecord = await prisma.admins.findFirst({
      where: { user_id: req.user.id },
      select: { permissions: true },
    });

    if (!adminRecord?.permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: this account does not have '${permission}' access`,
      });
    }

    next();
  };
}
