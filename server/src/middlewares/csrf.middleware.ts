import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
/**
 * Post-auth CSRF protection (JWT-verified double-submit).
 * Used for authenticated endpoints where an accessToken exists.
 *
 * Flow:
 * 1. Login response sets a JWT-based csrfToken cookie (bound to user ID)
 * 2. Frontend reads that cookie and sends it as X-CSRF-Token header
 * 3. This middleware verifies both the cookie and header match,
 *    and that the CSRF token belongs to the same user as the accessToken
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method)) {
    return next();
  }
  const csrfCookie = req.cookies?.csrfToken;
  const csrfHeader = req.headers["x-csrf-token"];
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({
      success: false,
      message: "Invalid CSRF Token",
    });
  }
  const csrfSecret = process.env.CSRF_SECRET;
  if (!csrfSecret) {
    throw new Error("CSRF_SECRET is not set");
  }
  try {
    const decoded = jwt.verify(csrfCookie, csrfSecret) as { sub: string };
    const accessToken = req.cookies?.accessToken;
    if (!accessToken) {
      return res.status(403).json({
        success: false,
        message: "Access token missing",
      });
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not set");
    }
    const accessDecoded = jwt.verify(accessToken, jwtSecret) as { id: string };
    if (decoded.sub !== accessDecoded.id) {
      return res.status(403).json({
        success: false,
        message: "CSRF Token Mismatch",
      });
    }
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired Token",
    });
  }
}