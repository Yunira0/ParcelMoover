import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

type RequestMetrics = {
  startedAt: number;
  databaseMs: number;
  databaseOperations: number;
  authMs: number;
  authStartedAt: number | null;
};

const metrics = new AsyncLocalStorage<RequestMetrics>();

type DatabasePoolMetrics = { max: number; total: number; idle: number; waiting: number };
let poolMetricsProvider: (() => DatabasePoolMetrics) | undefined;

export function setDatabasePoolMetricsProvider(provider: (() => DatabasePoolMetrics) | undefined) {
  poolMetricsProvider = provider;
}

// Disabled by default. Never record SQL, parameters, tokens, request bodies,
// account identifiers or query strings when diagnosing a slow request.
export function requestPerformance(req: Request, res: Response, next: NextFunction) {
  if (process.env.PERFORMANCE_TIMING !== "true") return next();

  const poolAtStart = poolMetricsProvider?.();

  const current: RequestMetrics = {
    startedAt: performance.now(), databaseMs: 0, databaseOperations: 0, authMs: 0, authStartedAt: null,
  };
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: Parameters<Response["writeHead"]>) {
    if (!res.headersSent) {
      res.setHeader("Server-Timing", [
        `api;dur=${(performance.now() - current.startedAt).toFixed(1)}`,
        `db;dur=${current.databaseMs.toFixed(1)}`,
        `auth;dur=${authenticationDuration(current).toFixed(1)}`,
        `db_ops;desc="${current.databaseOperations}"`,
      ].join(", "));
    }
    return Reflect.apply(writeHead, this, args);
  } as Response["writeHead"];

  res.once("finish", () => {
    console.info(JSON.stringify({
      event: "request_performance",
      method: req.method,
      // Route templates retain /:id, rather than logging a customer's URL.
      route: typeof req.route?.path === "string" ? `${req.baseUrl}${req.route.path}` : "unmatched",
      status: res.statusCode,
      durationMs: Number((performance.now() - current.startedAt).toFixed(1)),
      databaseMs: Number(current.databaseMs.toFixed(1)),
      databaseOperations: current.databaseOperations,
      authMs: Number(authenticationDuration(current).toFixed(1)),
      ...(poolAtStart ? { poolAtStart, poolAtFinish: poolMetricsProvider?.() } : {}),
    }));
  });
  metrics.run(current, next);
}

export async function timeDatabaseOperation<T>(run: () => Promise<T>): Promise<T> {
  const current = metrics.getStore();
  if (!current) return run();
  const start = performance.now();
  current.databaseOperations++;
  try {
    return await run();
  } finally {
    current.databaseMs += performance.now() - start;
  }
}

function authenticationDuration(current: RequestMetrics) {
  return current.authMs + (current.authStartedAt === null ? 0 : performance.now() - current.authStartedAt);
}

export async function timeAuthentication<T>(run: (finish: () => void) => Promise<T>): Promise<T> {
  const current = metrics.getStore();
  if (!current) return run(() => {});
  const start = performance.now();
  current.authStartedAt = start;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    current.authMs += performance.now() - start;
    current.authStartedAt = null;
  };
  try {
    return await run(finish);
  } finally {
    finish();
  }
}
