import { beforeAll, describe, expect, it } from "vitest";
import type { RidersReport } from "../../services/analytics/queries/riders";
import { renderOutdated, renderRiders } from "../stats/commands/riders";
import { configureColor } from "../stats/render";

const report: RidersReport = {
  asOf: "2026-10-09T08:47:00Z",
  apps: [
    { platform: "android", version: "1.4.3", riders: 82 },
    { platform: "android", version: null, riders: 10 },
    { platform: "web", version: "1.4.3", riders: 3 },
  ],
  activeToday: 95,
  online: 22,
  totalRiders: 140,
  newest: { version: "1.4.3", firstDay: "2026-10-08" },
  progress: [
    { day: "2026-10-08", onVersion: 59, android: 91 },
    { day: "2026-10-09", onVersion: 82, android: 92 },
  ],
  outdatedByBranch: [{ branch: "Kathmandu", riders: 4 }, { branch: "Pokhara", riders: 3 }],
};

beforeAll(() => configureColor(false));

describe("pm-stats riders output", () => {
  it("matches the designed layout", () => {
    const lines = renderRiders(report);
    expect(lines.slice(0, 9)).toEqual([
      "RIDER APP  ·  riders who used it today  ·  as of 14:32 NPT",
      "",
      "  App                     Riders   Share",
      "  Android app 1.4.3           82     86%   █████████████████████░░░  ● latest",
      "  Android app, very old       10     11%   ███░░░░░░░░░░░░░░░░░░░░░  ▲ please update",
      "  Web browser                  3      3%   █░░░░░░░░░░░░░░░░░░░░░░░  · updates itself when reopened",
      "  " + "─".repeat(38),
      "  Total                       95    100%",
      "",
    ]);
    const text = lines.join("\n");
    expect(text).toContain("How many Android riders have updated to 1.4.3");
    expect(text).toContain("  9 Oct 2026  ");
    expect(text).toContain("Kathmandu 4   ·   Pokhara 3");
    expect(text).toContain("22 riders online now. 45 of 140 riders have not used the app today.");
  });

  it("says so when no rider is active yet", () => {
    const text = renderRiders({ ...report, apps: [], activeToday: 0, progress: [], newest: null, outdatedByBranch: [] }).join("\n");
    expect(text).toContain("No rider has used the app yet today.");
    expect(text).toContain("None. Every Android rider has the latest version.");
  });

  it("lists outdated riders with Nepal time", () => {
    const lines = renderOutdated({
      ...report,
      outdated: [{ name: "Bikash", branch: "Kathmandu", version: null, lastSeen: "2026-10-09T18:20:00Z" }],
    });
    expect(lines[0]).toBe("RIDERS TO UPDATE  ·  latest version: 1.4.3  ·  Fri 9 Oct 2026  ·  as of 14:32 NPT");
    expect(lines[3]).toBe("  Bikash                    Kathmandu                 very old      10 Oct, 00:05");
  });
});
