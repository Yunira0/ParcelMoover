import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

vi.mock("../../services/analytics/traffic", () => ({ recordRequest: vi.fn() }));

import { recordRequest } from "../../services/analytics/traffic";
import { usageTrackingMiddleware } from "../usageTracking.middleware";

const recorded = recordRequest as unknown as ReturnType<typeof vi.fn>;

function run(req: Partial<Request>, contentType = "application/json", status = 200) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: status,
    getHeader: (name: string) => (name === "content-type" ? contentType : undefined),
  }) as unknown as Response & EventEmitter;
  const next = vi.fn() as unknown as NextFunction;
  const fullReq = {
    method: "GET", originalUrl: "/api/orders", baseUrl: "/api/orders", route: { path: "/:id" }, headers: {},
    ...req,
  } as Request;
  usageTrackingMiddleware(fullReq, res, next);
  res.emit("finish");
  return next;
}

describe("usageTrackingMiddleware", () => {
  beforeEach(() => recorded.mockReset());

  it("records the route template, status and app after the response", () => {
    const next = run({}, "application/json", 404);
    expect(next).toHaveBeenCalledWith();
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({
      app: "dashboard", method: "GET", route: "/api/orders/:id", status: 404,
    }));
  });

  it("tells the rider app and the Partner API apart", () => {
    run({ headers: { "x-app-platform": "android" } });
    run({ user: { roles: ["rider"] } as NonNullable<Request["user"]> });
    run({ originalUrl: "/api/v1/orders", apiKey: { id: "key-1", vendorId: "v", userId: "u" } } as Partial<Request>);
    expect(recorded.mock.calls.map(([sample]) => [sample.app, sample.apiKeyId])).toEqual([
      ["rider", undefined], ["rider", undefined], ["partner", "key-1"],
    ]);
  });

  it("skips event streams and CORS preflights", () => {
    run({}, "text/event-stream; charset=utf-8");
    const next = run({ method: "OPTIONS" });
    expect(next).toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
  });

  it("never lets a counting failure reach the response", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenRoute = { get path(): string { throw new Error("boom"); } };
    expect(() => run({ route: brokenRoute })).not.toThrow();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
