import { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AdminPermission } from "../types/adminPermission.type";

/**
 * True if the actor holds a delegated admin permission: super_admin always
 * does; a plain admin only if it's in their admins.permissions (granted by a
 * super_admin); every other role never does - callers gate route access by
 * role separately. Shared by requireAdminPermission below and by service code
 * that needs the same check outside of an Express middleware (e.g.
 * updateOrderDetails's COD-on-terminal-status bypass).
 */
export async function hasAdminPermission(
  actor: { id: string; roles: string[] },
  permission: AdminPermission,
): Promise<boolean> {
  if (actor.roles.includes("super_admin")) return true;
  if (!actor.roles.includes("admin")) return false;

  const adminRecord = await prisma.admins.findFirst({
    where: { user_id: actor.id },
    select: { permissions: true },
  });

  return Boolean(adminRecord?.permissions.includes(permission));
}

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

    if (!(await hasAdminPermission(req.user, permission))) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: this account does not have '${permission}' access`,
      });
    }

    next();
  };
}
