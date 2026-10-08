import express from "express";
import request from "supertest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({ default: { api_keys: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) } } }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue("OK") } }));
vi.mock("../../services/apiKey.service", () => ({
  API_KEY_CACHE_TTL_SECONDS: 60,
  apiKeyCacheKey: (value: string) => `key:${value}`,
  hashApiKey: (value: string) => value,
  isApiKeyShaped: (value: string) => value.startsWith("pm_live_"),
}));

import prisma from "../../lib/prisma";
import { requestPerformance } from "../../lib/requestPerformance";
import { apiKeyAuthMiddleware } from "../apiKeyAuth.middleware";

const lookup = prisma.api_keys.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.stubEnv("PERFORMANCE_TIMING", "true"); vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function app() {
  const application = express();
  application.use("/api", requestPerformance);
  const router = express.Router();
  router.get("/orders", apiKeyAuthMiddleware, (req, res) => res.json({ vendorId: req.apiKey!.vendorId }));
  application.use("/api/v1", router);
  return application;
}

it("keeps Partner API vendor identities separate while timing authentication", async () => {
  lookup.mockImplementation(async (args: { where: { key_hash: string } }) => ({
    id: args.where.key_hash,
    revoked_at: null,
    vendors: { id: args.where.key_hash === "pm_live_a" ? "vendor-a" : "vendor-b", user_id: "owner", status: "active", deleted_at: null },
  }));
  const application = app();
  const [a, b] = await Promise.all([
    request(application).get("/api/v1/orders").set("Authorization", "Bearer pm_live_a"),
    request(application).get("/api/v1/orders").set("X-API-Key", "pm_live_b"),
  ]);
  expect(a.body).toEqual({ vendorId: "vendor-a" });
  expect(b.body).toEqual({ vendorId: "vendor-b" });
  expect(a.headers["server-timing"]).toContain("auth;dur=");
  expect(b.headers["server-timing"]).toContain("auth;dur=");
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/pm_live_|vendor-a|vendor-b/);
});

it("still rejects a revoked Partner API key with the existing structured error", async () => {
  lookup.mockResolvedValue({
    id: "revoked", revoked_at: new Date(), vendors: { id: "vendor-a", user_id: "owner", status: "active", deleted_at: null },
  });
  const response = await request(app()).get("/api/v1/orders").set("Authorization", "Bearer pm_live_revoked");
  expect(response.status).toBe(401);
  expect(response.body).toEqual({ success: false, message: "Invalid or revoked API key", error: { code: "UNAUTHORIZED" } });
  expect(response.headers["server-timing"]).toContain("auth;dur=");
});
