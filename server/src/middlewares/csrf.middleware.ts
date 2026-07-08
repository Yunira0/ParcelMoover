import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { ACCESS_TOKEN_AUDIENCE, CSRF_TOKEN_AUDIENCE, JWT_ISSUER } from "../utils/jwtConfig";

/**
 * Constant-time string comparison to avoid leaking token contents via a
 * timing side-channel. Returns false on any length mismatch (timingSafeEqual
 * throws when buffer lengths differ).
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

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
  // Bearer token clients are not vulnerable to CSRF (no browser auto-sends cookies for them).
  // This exemption is only safe as long as the JWT never becomes JS-readable
  // client-side (no response body, no localStorage) — it currently lives solely
  // in an httpOnly cookie. If that ever changes, this bypass needs revisiting.
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }
  const csrfCookie = req.cookies?.csrfToken;
  const rawHeader = req.headers["x-csrf-token"];
  const csrfHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!csrfCookie || !csrfHeader || !safeEqual(csrfCookie, csrfHeader)) {
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
    const decoded = jwt.verify(csrfCookie, csrfSecret, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: CSRF_TOKEN_AUDIENCE,
    }) as { sub: string };
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
    const accessDecoded = jwt.verify(accessToken, jwtSecret, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    }) as { id: string };
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