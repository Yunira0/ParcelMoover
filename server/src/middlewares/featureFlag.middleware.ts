import { NextFunction, Request, Response } from "express";

// Gates routes for features that are built but not released. Off unless the
// env var is exactly "true"; while off the route answers 404 as if it didn't
// exist, before auth or any database work.
export const requireFeature = (envVar: string) =>
  (_req: Request, res: Response, next: NextFunction) => {
    if (process.env[envVar] === "true") return next();
    res.status(404).json({ success: false, message: "Not found" });
  };
