import { NextFunction, Request, Response } from "express";

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

  next();
}
