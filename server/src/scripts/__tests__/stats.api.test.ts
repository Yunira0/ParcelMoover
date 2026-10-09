import { beforeAll, describe, expect, it } from "vitest";
import { type ApiReport, summarize } from "../../services/analytics/queries/api";
import { formatMs, renderApi } from "../stats/commands/api";
import { configureColor } from "../stats/render";

const slot = (n: number, slowFive: boolean) => ({
  "req|dashboard": String(n), "b2|dashboard": String(n - (slowFive ? 5 : 0)), ...(slowFive ? { "b6|dashboard": "5" } : {}),
  "r|GET /api/parcels|n": String(n), "r|GET /api/parcels|b6": slowFive ? "5" : "0", "r|GET /api/parcels|b2": String(n - (slowFive ? 5 : 0)),
});

const report: ApiReport = {
  asOf: "2026-10-09T08:47:00Z",
  window: "1h",
  from: "2026-10-09T07:48:00Z",
  summary: summarize(Array.from({ length: 60 }, (_, i) => (i === 59 ? slot(40, true) : slot(10, false)))),
  recentErrors: [{ at: "2026-10-09T08:46:52Z", status: 502, method: "GET", route: "/api/parcels" }],
  server: { loadPct: 38, memoryUsedPct: 61, diskUsedPct: 84, db: { inUse: 9, max: 100 }, redis: { ok: true, usedMemory: "2M" } },
  redisError: null,
};

beforeAll(() => configureColor(false));

describe("pm-stats api output", () => {
  it("shows totals, speed, the trend and the slowest route", () => {
    const text = renderApi(report).join("\n");
    expect(text).toContain("API TRAFFIC  ·  last 1 hour  ·  13:33–14:32 NPT");
    expect(text).toMatch(/Requests {4}630 {3}· {3}11 a minute/);
    expect(text).toContain("Server errors   0.0%   ● ok");
    expect(text).toContain("  13:33");
    expect(text).toContain("Dashboard              630     100%");
    expect(text).toMatch(/GET \/api\/parcels\s+630\s+\d+ ms {6}0.0%/);
    expect(text).toContain("Disk 84% ▲");
    expect(text).toContain("Database 9 / 100 connections");
    expect(text).toContain("502   GET /api/parcels");
  });

  it("says when Redis could not be read", () => {
    const text = renderApi({ ...report, summary: summarize([]), redisError: "connect ECONNREFUSED" }).join("\n");
    expect(text).toContain("✕ Could not read the request counts: the cache (Redis) is unreachable (connect ECONNREFUSED)");
    expect(text).toContain("No requests counted in this time yet.");
  });

  it("formats durations", () => {
    expect([null, 12.4, 999, 1840, Infinity].map(formatMs)).toEqual(["–", "12 ms", "999 ms", "1.8 s", ">5 s"]);
  });
});
