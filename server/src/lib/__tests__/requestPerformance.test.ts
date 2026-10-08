import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPerformance, timeAuthentication, timeDatabaseOperation, setDatabasePoolMetricsProvider } from "../requestPerformance";

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("PERFORMANCE_TIMING", "true");
  log = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { setDatabasePoolMetricsProvider(undefined); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function app() {
  const application = express();
  application.use("/api", requestPerformance);
  return application;
}

describe("request diagnostics", () => {
  it("logs numeric pool snapshots only in operator diagnostics", async () => {
    setDatabasePoolMetricsProvider(() => ({ max: 20, total: 15, idle: 2, waiting: 3 }));
    const application = app();
    application.get("/api/test", (_req, res) => res.json({ ok: true }));
    const response = await request(application).get("/api/test?token=private");
    expect(response.body).toEqual({ ok: true });
    const output = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output.poolAtStart).toEqual({ max: 20, total: 15, idle: 2, waiting: 3 });
    expect(output.poolAtFinish).toEqual(output.poolAtStart);
    expect(JSON.stringify(output)).not.toContain("private");
    expect(response.headers["server-timing"]).not.toContain("pool");
  });
  it("is disabled by default and preserves responses", async () => {
    vi.stubEnv("PERFORMANCE_TIMING", "false");
    const application = app();
    application.get("/api/test", async (_req, res) => {
      await timeDatabaseOperation(async () => 1);
      res.json({ ok: true });
    });
    const response = await request(application).get("/api/test");
    expect(response.body).toEqual({ ok: true });
    expect(response.headers["server-timing"]).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("isolates concurrent requests and reports logical database operations", async () => {
    const application = app();
    application.get("/api/test/:count", async (req, res) => {
      await Promise.all(Array.from({ length: Number(req.params.count) }, () => timeDatabaseOperation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return 1;
      })));
      res.json({ ok: true });
    });
    const [one, three] = await Promise.all([
      request(application).get("/api/test/1?token=secret"),
      request(application).get("/api/test/3?customer=private"),
    ]);
    expect(one.headers["server-timing"]).toContain('db_ops;desc="1"');
    expect(three.headers["server-timing"]).toContain('db_ops;desc="3"');
    const output: Array<{ route: string; databaseOperations: number }> = log.mock.calls.map(([message]: unknown[]) => JSON.parse(String(message)));
    expect(output.map((entry) => entry.databaseOperations).sort()).toEqual([1, 3]);
    expect(output.every((entry) => entry.route === "/api/test/:count")).toBe(true);
    expect(JSON.stringify(output)).not.toMatch(/secret|private|customer|token/);
  });

  it("retains database errors and records failed operations", async () => {
    const application = app();
    application.get("/api/test", async (_req, res) => {
      try { await timeDatabaseOperation(async () => { throw new Error("SQL with private values"); }); }
      catch { res.status(503).json({ error: "Unavailable" }); }
    });
    const response = await request(application).get("/api/test");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Unavailable" });
    expect(response.headers["server-timing"]).toContain('db_ops;desc="1"');
    expect(String(log.mock.calls[0]?.[0])).not.toContain("private");
  });

  it("ends authentication timing before the downstream route runs", async () => {
    const application = app();
    application.use((_req, _res, next) => timeAuthentication(async (finish) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finish(); next();
    }));
    application.get("/api/test", async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      res.json({ ok: true });
    });
    const response = await request(application).get("/api/test");
    const timing = String(response.headers["server-timing"] ?? "");
    const authMs = Number(/auth;dur=([\d.]+)/.exec(timing)?.[1]);
    const apiMs = Number(/api;dur=([\d.]+)/.exec(timing)?.[1]);
    expect(authMs).toBeGreaterThan(0);
    expect(apiMs - authMs).toBeGreaterThanOrEqual(20);
  });
});
