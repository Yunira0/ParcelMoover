import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = {
  hincrby: vi.fn(),
  expire: vi.fn(),
  hset: vi.fn(),
  lpush: vi.fn(),
  ltrim: vi.fn(),
  exec: vi.fn(),
};
vi.mock("../../../lib/redis", () => ({ default: { pipeline: () => pipeline } }));

import { flushTraffic, recordRequest } from "../traffic";
import { bucketIndex, hourKey, minuteKey, nepalDay } from "../trafficKeys";
import { percentileMs, summarize } from "../queries/api";

const at = new Date("2026-10-09T08:47:12Z");

function increments(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, field, n] of pipeline.hincrby.mock.calls as [string, string, number][]) {
    (out[key] ??= {})[field] = n;
  }
  return out;
}

describe("request counting", () => {
  beforeEach(() => {
    for (const fn of Object.values(pipeline)) fn.mockReset();
    pipeline.exec.mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("names keys by UTC minute and hour, and days by Nepal date", () => {
    expect(minuteKey(at)).toBe("pm:traffic:m:202610090847");
    expect(hourKey(at)).toBe("pm:traffic:h:2026100908");
    expect(nepalDay(new Date("2026-10-09T18:20:00Z"))).toBe("2026-10-10");
  });

  it("puts each duration in its latency bucket", () => {
    expect([0, 25, 26, 999, 1000, 5000, 5001].map(bucketIndex)).toEqual([0, 0, 1, 5, 5, 7, 8]);
  });

  it("batches counts per minute and hour, then writes them in one pipeline", async () => {
    recordRequest({ at, app: "dashboard", method: "GET", route: "/api/orders", status: 200, durationMs: 40 });
    recordRequest({ at, app: "dashboard", method: "GET", route: "/api/orders", status: 503, durationMs: 1200 });
    await flushTraffic();

    const counts = increments();
    for (const key of [minuteKey(at), hourKey(at)]) {
      expect(counts[key]).toEqual({
        "req|dashboard": 2, "b1|dashboard": 1, "b6|dashboard": 1,
        "r|GET /api/orders|n": 2, "r|GET /api/orders|b1": 1, "r|GET /api/orders|b6": 1,
        "5xx|dashboard": 1, "r|GET /api/orders|e": 1,
      });
    }
    expect(pipeline.expire).toHaveBeenCalledWith(minuteKey(at), 2 * 86_400);
    expect(pipeline.expire).toHaveBeenCalledWith(hourKey(at), 8 * 86_400);
    expect(pipeline.lpush).toHaveBeenCalledWith("pm:traffic:errors",
      JSON.stringify({ at: at.toISOString(), status: 503, method: "GET", route: "/api/orders" }));
    expect(pipeline.exec).toHaveBeenCalledTimes(1);

    // Nothing left over for the next flush.
    pipeline.exec.mockClear();
    await flushTraffic();
    expect(pipeline.exec).not.toHaveBeenCalled();
  });

  it("counts Partner API calls and failures per key per Nepal day", async () => {
    recordRequest({ at, app: "partner", method: "POST", route: "/api/v1/orders", status: 201, durationMs: 90, apiKeyId: "key-1" });
    recordRequest({ at, app: "partner", method: "POST", route: "/api/v1/orders", status: 422, durationMs: 30, apiKeyId: "key-1" });
    await flushTraffic();

    expect(increments()["pm:apikeys:d:2026-10-09"]).toEqual({ "key-1|n": 2, "key-1|fail": 1, "key-1|s422": 1 });
    expect(pipeline.hset).toHaveBeenCalledWith("pm:apikeys:last", "key-1", String(at.getTime()));
  });

  it("drops a batch when Redis is down instead of keeping it in memory", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    pipeline.exec.mockRejectedValue(new Error("Connection is closed."));
    recordRequest({ at, app: "rider", method: "GET", route: "/api/me", status: 200, durationMs: 10 });
    await expect(flushTraffic()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);

    pipeline.exec.mockReset();
    await flushTraffic();
    expect(pipeline.exec).not.toHaveBeenCalled();
  });
});

describe("reading counts back", () => {
  it("adds up slots per app and route, keeping a per-slot series", () => {
    const summary = summarize([
      { "req|dashboard": "3", "b0|dashboard": "3", "r|GET /api/me|n": "3", "r|GET /api/me|b0": "3" },
      {},
      { "req|rider": "2", "5xx|rider": "1", "b8|rider": "2", "r|GET /api/me|n": "2", "r|GET /api/me|e": "1", "r|GET /api/me|b8": "2" },
    ]);
    expect(summary.series).toEqual([3, 0, 2]);
    expect(summary.overall).toMatchObject({ requests: 5, errors: 1 });
    expect(summary.apps.rider).toMatchObject({ requests: 2, errors: 1 });
    expect(summary.routes).toEqual([
      { route: "GET /api/me", requests: 5, errors: 1, buckets: [3, 0, 0, 0, 0, 0, 0, 0, 2] },
    ]);
  });

  it("estimates percentiles inside the right bucket", () => {
    // 100 requests: 90 under 25 ms, 10 between 500 ms and 1 s.
    const buckets = [90, 0, 0, 0, 0, 10, 0, 0, 0];
    expect(percentileMs(buckets, 0.5)).toBeCloseTo(13.9, 1);
    expect(percentileMs(buckets, 0.95)).toBe(750);
    expect(percentileMs([0, 0, 0, 0, 0, 0, 0, 0, 4], 0.95)).toBe(Infinity);
    expect(percentileMs(Array(9).fill(0), 0.5)).toBeNull();
  });
});
