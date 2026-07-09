import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

// Trusts an upstream-supplied X-Request-Id (e.g. a gateway/load balancer that
// already assigns one) so a request can be correlated across services;
// generates one otherwise. Always echoed back so the client can report it.
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
