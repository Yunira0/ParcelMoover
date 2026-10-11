import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";
import { routeTemplate } from "../lib/requestPerformance";
import { recordRequest } from "../services/analytics/traffic";
import type { TrafficApp } from "../services/analytics/trafficKeys";

// Counts every finished /api request for pm-stats: route template (never the
// real URL), status, time taken and which app sent it. Long-lived event
// streams and CORS preflights are skipped. Must never affect the response.
export function usageTrackingMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS") return next();
  const startedAt = performance.now();

  res.once("finish", () => {
    try {
      if (String(res.getHeader("content-type") ?? "").startsWith("text/event-stream")) return;
      recordRequest({
        at: new Date(),
        app: appFor(req),
        method: req.method,
        route: routeTemplate(req),
        status: res.statusCode,
        durationMs: performance.now() - startedAt,
        apiKeyId: req.apiKey?.id,
      });
    } catch (error) {
      console.error("[Analytics] Failed to count request:", error);
    }
  });
  next();
}

function appFor(req: Request): TrafficApp {
  if (req.originalUrl.startsWith("/api/v1/") || req.originalUrl === "/api/v1") return "partner";
  if (req.headers["x-app-platform"] || req.user?.roles.includes("rider")) return "rider";
  return "dashboard";
}
