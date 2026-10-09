import { beforeAll, describe, expect, it } from "vitest";
import { lastDays, type UsersReport } from "../../services/analytics/queries/users";
import { renderUsers } from "../stats/commands/users";
import { bar, configureColor, nepalDate, nepalTime, sparkline } from "../stats/render";

const days = lastDays("2026-10-09", 30);

const report: UsersReport = {
  asOf: "2026-10-09T08:47:00Z",
  today: "2026-10-09",
  trackingSince: "2026-08-01",
  groups: {
    staff: { online: 6, today: 18, last7Days: 22, last30Days: 25, total: 31 },
    vendor: { online: 14, today: 112, last7Days: 260, last30Days: 410, total: 590 },
    rider: { online: 22, today: 95, last7Days: 120, last30Days: 128, total: 140 },
    all: { online: 42, today: 225, last7Days: 402, last30Days: 563, total: 761 },
  },
  trend: {
    days,
    staff: days.map((_, i) => (i === 29 ? 18 : 12 + (i % 9))),
    vendor: days.map((_, i) => 58 + i * 2),
    rider: days.map((_, i) => 61 + i),
  },
  newVendors: { today: 3, last7Days: 19, last30Days: 64 },
};

beforeAll(() => configureColor(false));

describe("pm-stats users output", () => {
  it("matches the designed table layout", () => {
    const lines = renderUsers(report);
    expect(lines.slice(0, 9)).toEqual([
      "USERS  ·  Fri 9 Oct 2026  ·  as of 14:32 NPT",
      "",
      "            Online   Today   7 days   30 days    Total    Used it in 30 days",
      "  Staff          6      18       22        25       31    ████████░░  81%",
      "  Vendors       14     112      260       410      590    ███████░░░  69%",
      "  Riders        22      95      120       128      140    █████████░  91%",
      "  " + "─".repeat(71),
      "  All           42     225      402       563      761    ███████░░░  74%",
      "",
    ]);
  });

  it("shows a 30-day trend with its low and high", () => {
    const line = [...renderUsers(report)].reverse().find((l) => l.startsWith("  Vendors  "));
    expect(line).toBe(`  Vendors  ${sparkline(report.trend.vendor)}     58   116`);
  });

  it("says so when tracking is newer than the 30-day window", () => {
    const fresh = renderUsers({ ...report, trackingSince: "2026-10-05" }).join("\n");
    expect(fresh).toContain("Counting started on 5 Oct 2026, so the 7- and 30-day numbers are still filling in.");
    expect(renderUsers(report).join("\n")).not.toContain("Counting started");
  });

  it("counts people not seen in 30 days from active accounts", () => {
    expect(renderUsers(report).join("\n")).toContain("Not seen in 30 days    staff 6   ·   vendors 180   ·   riders 12");
  });
});

describe("render helpers", () => {
  it("draws bars and sparklines", () => {
    expect(bar(0.5, 4)).toBe("██░░");
    expect(sparkline([0, 7])).toBe("▁█");
    expect(sparkline([0, 0])).toBe("▁▁");
    expect(sparkline([5, 5])).toBe("▄▄");
  });

  it("prints Nepal date and time", () => {
    const at = new Date("2026-10-09T18:20:00Z"); // 00:05 on 10 Oct in Nepal
    expect(nepalDate(at)).toBe("Sat 10 Oct 2026");
    expect(nepalTime(at)).toBe("00:05");
  });
});
