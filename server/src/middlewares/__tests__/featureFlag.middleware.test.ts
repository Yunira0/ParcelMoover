import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requireFeature } from "../featureFlag.middleware";

const run = () => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
  const next = vi.fn();
  requireFeature("TEST_FEATURE_ENABLED")({} as Request, res, next);
  return { res, next };
};

describe("requireFeature", () => {
  afterEach(() => { delete process.env.TEST_FEATURE_ENABLED; });

  it("answers 404 while the flag is unset", () => {
    const { res, next } = run();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("stays off for values other than exactly \"true\"", () => {
    process.env.TEST_FEATURE_ENABLED = "1";
    expect(run().next).not.toHaveBeenCalled();
  });

  it("passes through when the flag is \"true\"", () => {
    process.env.TEST_FEATURE_ENABLED = "true";
    const { res, next } = run();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
