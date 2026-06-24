import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";
export function authorizeRoles(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const userRoles = req.user.roles;
    const hasAllowedRole = userRoles.some((role) =>
      allowedRoles.includes(role),
    );

    if (!hasAllowedRole) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Insuffucient Privilege",
      });
    }
    next();
  };
}
