import { beforeAll, describe, expect, it } from "vitest";
import { summarize } from "../../services/analytics/queries/api";
import type { BusinessReport } from "../../services/analytics/queries/business";
import { parseKeyDay, type VendorsReport } from "../../services/analytics/queries/vendors";
import { change, renderBusiness } from "../stats/commands/business";
import { frame, type LiveState, liveAlerts, renderLive, usedOverTime } from "../stats/commands/live";
import { renderVendors, vendorAttention } from "../stats/commands/vendors";
import { configureColor, npr } from "../stats/render";

const asOf = "2026-10-09T08:47:00Z";

const vendors: VendorsReport = {
  asOf,
  keys: [
    { keyId: "k1", vendorId: "v1", vendor: "Vendor A", keyPrefix: "pm_live_3f9c", revoked: false, calls: 3120, failed: 12,
      statuses: { "422": 12 }, lastCallAt: "2026-10-09T08:46:00Z", yesterdayCalls: 3000 },
    { keyId: "k2", vendorId: "v2", vendor: "Vendor C", keyPrefix: "pm_live_09be", revoked: false, calls: 1610, failed: 72,
      statuses: { "422": 60, "404": 12 }, lastCallAt: "2026-10-09T08:44:00Z", yesterdayCalls: 1500 },
    { keyId: "k3", vendorId: "v3", vendor: "Vendor G", keyPrefix: "pm_live_b06e", revoked: false, calls: 0, failed: 0,
      statuses: {}, lastCallAt: "2026-10-09T05:20:00Z", yesterdayCalls: 240 },
  ],
  webhooks: [
    { vendorId: "v1", vendor: "Vendor A", delivered: 412, retrying: 0, failed: 0, lastFailureCode: null, failingSince: null },
    { vendorId: "v2", vendor: "Vendor C", delivered: 100, retrying: 37, failed: 0, lastFailureCode: 503, failingSince: "2026-10-09T06:30:00Z" },
  ],
  disabledEndpoints: [],
  redisError: null,
};

const business: BusinessReport = {
  asOf,
  created: { today: 1284, lastWeek: 1190, yesterday: 1402 },
  pickedUp: { today: 1102, lastWeek: 1060, yesterday: 1350 },
  delivered: { today: 968, lastWeek: 941, yesterday: 1210 },
  returned: { today: 41, lastWeek: 47, yesterday: 52 },
  cancelled: { today: 18, lastWeek: 15, yesterday: 22 },
  codCollected: { today: 1842300, lastWeek: 1795000, yesterday: 2210450 },
  outForDelivery: 412,
  inProgress: 1300,
  branches: [{ branch: "Kathmandu", orders: 612, delivered: 471, returned: 18, cod: 912400 }],
  branchFilter: null,
};

beforeAll(() => configureColor(false));

describe("pm-stats vendors", () => {
  it("reads per-key counts from the day hash", () => {
    expect(parseKeyDay({ "k1|n": "5", "k1|fail": "2", "k1|s422": "2", "bad": "9" }).get("k1"))
      .toEqual({ calls: 5, failed: 2, statuses: { "422": 2 } });
  });

  it("flags failing integrations, failing webhooks and vendors gone quiet", () => {
    expect(vendorAttention(vendors).map((a) => `${a.level} ${a.who}: ${a.text}`)).toEqual([
      "warn Vendor C: 72 of 1,610 calls failed today. Most are 422: invalid order data.",
      "warn Vendor G: No calls since 9 Oct, 11:05. Yesterday it made 240.",
      "bad Vendor C: 37 webhook deliveries failing since 12:15 (last: HTTP 503).",
    ]);
  });

  it("lists today's keys with their webhooks", () => {
    const text = renderVendors(vendors).join("\n");
    expect(text).toContain("2 vendors called the API today   ·   4,730 calls   ·   1.8% failed");
    expect(text).toContain("  Vendor A              pm_live_3f9c…       3,120     0.4%       14:31   ● 412 delivered");
    expect(text).toContain("4.5% ▲");
    expect(text).toContain("✕ 37 failing (HTTP 503)");
    expect(text).not.toContain("pm_live_b06e");
  });
});

describe("pm-stats vendors --all", () => {
  const many: VendorsReport = {
    ...vendors,
    keys: Array.from({ length: 18 }, (_, i) => ({ ...vendors.keys[0]!, keyId: `k${i}`, vendor: `Vendor ${i}` })),
  };

  it("shows the top 15 and how to see the rest", () => {
    const text = renderVendors(many).join("\n");
    expect(text).toContain("+ 3 more vendors   ·   pm-stats vendors --all");
    expect(text).not.toContain("Vendor 17");
  });

  it("lists everyone with --all", () => {
    const text = renderVendors(many, true).join("\n");
    expect(text).toContain("Vendor 17");
    expect(text).not.toContain("more vendors");
  });
});

describe("pm-stats business", () => {
  it("compares with the same time last week", () => {
    expect(change(business.created, true)).toEqual({ text: "▲ 8%", style: "good" });
    expect(change(business.returned, false)).toEqual({ text: "▼ 13%", style: "good" });
    expect(change({ today: 0, lastWeek: 0, yesterday: 3 }, true)).toBe("–");
  });

  it("shows a plain difference when last week's number is small", () => {
    // 5 → 18 would read "▲ 260%".
    expect(change({ today: 18, lastWeek: 5, yesterday: 9 }, false)).toEqual({ text: "▲ +13", style: "warn" });
    expect(change({ today: 12, lastWeek: 15, yesterday: 9 }, false)).toEqual({ text: "▼ -3", style: "good" });
    expect(change({ today: 7, lastWeek: 7, yesterday: 9 }, true)).toBe("same");
    expect(change({ today: 20, lastWeek: 20, yesterday: 9 }, true)).toBe("0%");
  });

  it("matches the designed layout", () => {
    const lines = renderBusiness(business);
    expect(lines.slice(2, 10)).toEqual([
      "                           Today     Last week   Change      Yesterday",
      "                        to 14:32      to 14:32                full day",
      "  Orders created           1,284         1,190     ▲ 8%          1,402",
      "  Picked up                1,102         1,060     ▲ 4%          1,350",
      "  Delivered                  968           941     ▲ 3%          1,210",
      "  Returned                    41            47    ▼ 13%             52",
      "  Cancelled                   18            15     ▲ +3             22",
      "  COD collected    NPR 18,42,300 NPR 17,95,000     ▲ 3%  NPR 22,10,450",
    ]);
    expect(lines.join("\n")).toContain("Success rate today       95.9%");
  });

  it("formats rupees with Nepali grouping", () => {
    expect(npr(1842300.4)).toBe("NPR 18,42,300");
  });
});

describe("pm-stats live", () => {
  const state: LiveState = {
    at: asOf,
    api: {
      asOf, window: "1h", from: asOf, recentErrors: [], redisError: null,
      summary: summarize([{ "req|dashboard": "100", "5xx|dashboard": "5", "b2|dashboard": "100" }]),
      server: { loadPct: 20, memoryUsedPct: 50, diskUsedPct: 85, db: { inUse: 10, max: 100 }, redis: { ok: true, usedMemory: "1M" } },
    },
    users: {
      asOf, today: "2026-10-09", trackingSince: "2026-10-01",
      groups: {
        staff: { online: 1, today: 2, last7Days: 3, last30Days: 4, total: 5 },
        vendor: { online: 0, today: 0, last7Days: 0, last30Days: 0, total: 0 },
        rider: { online: 2, today: 3, last7Days: 3, last30Days: 3, total: 4 },
        all: { online: 3, today: 5, last7Days: 6, last30Days: 7, total: 9 },
      },
      trend: { days: [], staff: [], vendor: [], rider: [] },
      newVendors: { today: 0, last7Days: 0, last30Days: 0 },
    },
    riders: {
      asOf, activeToday: 3, online: 2, totalRiders: 4, progress: [], newest: { version: "1.4.3", firstDay: "2026-10-08" },
      apps: [{ platform: "android", version: "1.4.3", riders: 2 }, { platform: "android", version: null, riders: 1 }],
      outdatedByBranch: [{ branch: "Kathmandu", riders: 1 }],
    },
    business,
    vendors,
    error: null,
  };

  it("raises alerts in order of what needs a person", () => {
    expect(liveAlerts(state).map((a) => a.text)).toEqual([
      "5.0% of requests failed in the last hour",
      "Disk is 85% full",
      "Vendor C: 72 of 1,610 calls failed today. Most are 422: invalid order data.",
      "Vendor G: No calls since 9 Oct, 11:05. Yesterday it made 240.",
      "Vendor C: 37 webhook deliveries failing since 12:15 (last: HTTP 503).",
      "1 riders need to update the app (pm-stats riders --outdated)",
    ]);
  });

  it("draws the panel grid with straight edges on a wide terminal", () => {
    const lines = renderLive(state, 140);
    for (const title of ["USERS", "TRAFFIC · LAST HOUR", "SERVER", "RIDER APP", "BUSINESS TODAY", "LATEST SERVER ERRORS", "ALERTS"]) {
      expect(lines.join("\n")).toContain(` ${title} `);
    }
    // Every panel row lines up: same width all the way down.
    const grid = lines.slice(2);
    expect(new Set(grid.map((l) => l.length))).toEqual(new Set([grid[0]!.length]));
    const text = lines.join("\n");
    expect(text).toContain("3 online now");
    expect(text).toContain("App 1.4.3");
    expect(text).toMatch(/Orders\s+1,284 {2}▲ 8%/);
    expect(text).toContain("● None recorded.");
  });

  it("redraws in place and never scrolls the terminal", () => {
    const lines = renderLive(state, 80);
    const out = frame(lines, 20, 80);
    expect(out.startsWith("\x1b[H")).toBe(true);
    expect(out.endsWith("\x1b[J")).toBe(true);
    expect(out).not.toContain("\x1b[2J");
    const shown = out.slice(3).split("\r\n").map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""));
    // Fits the window: at most rows - 1 lines, none wider than the columns.
    expect(shown.length).toBe(19);
    expect(Math.max(...shown.map((l) => l.length))).toBeLessThanOrEqual(80);
    expect(shown[shown.length - 1]).toMatch(/^▼ \d+ more lines: make the window taller to see everything$/);
  });

  it("shows everything when the window is big enough", () => {
    const lines = renderLive(state, 140);
    const shown = frame(lines, 60, 140).split("\r\n");
    expect(shown.length).toBe(lines.length);
    expect(frame(lines, 60, 140)).not.toContain("more lines");
  });

  it("never counts an app without a version as the latest", () => {
    // No rider has an app that reports its version yet: every Android app is old.
    const before = {
      ...state,
      riders: { ...state.riders, newest: null, apps: [{ platform: "android", version: null, riders: 8 }], activeToday: 8 },
    };
    const text = renderLive(before, 140).join("\n");
    expect(text).toMatch(/Latest app\s+░+\s+0 /);
    expect(text).toMatch(/Older app\s+█+\s+8 ▲/);
  });

  it("says how far back the people count goes instead of repeating today's number", () => {
    const users = (trackingSince: string | null) => ({ ...state.users, today: "2026-10-09", trackingSince });
    expect(usedOverTime(users("2026-10-09"))).toBe("Counting began today.");
    expect(usedOverTime(users(null))).toBe("Counting began today.");
    expect(usedOverTime(users("2026-10-06"))).toBe("Since 6 Oct: 7  (counting began then)");
    expect(usedOverTime(users("2026-09-20"))).toBe("Last 7 days 6  ·  since 20 Sept 7");
    expect(usedOverTime(users("2026-08-01"))).toBe("Last 7 days 6  ·  last 30 days 7");
    const text = renderLive({ ...state, users: users("2026-10-09") }, 140).join("\n");
    expect(text).toContain("Used it today 5");
    expect(text).not.toMatch(/7 days 6 .*30 days/);
  });

  it("says COD is cash collected", () => {
    expect(renderLive(state, 140).join("\n")).toMatch(/COD collected\s+NPR 18,42,300/);
  });

  it("stacks the panels on a narrow terminal", () => {
    const lines = renderLive(state, 80);
    expect(lines).toContain("USERS");
    expect(lines.every((l) => !l.includes("╭"))).toBe(true);
  });
});
