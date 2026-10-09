import { getRidersReport, type AppRow, type RidersReport } from "../../../services/analytics/queries/riders";
import {
  bar, type Column, formatRow, heading, nepalDate, nepalDayTime, nepalTime, num, paint, percent, rule, shortDay,
} from "../render";

const COLUMNS: Column[] = [{ width: 22, align: "left" }, { width: 8 }, { width: 8 }];

export async function ridersCommand(options: { json: boolean; outdated: boolean }): Promise<string> {
  const report = await getRidersReport({ listOutdated: options.outdated });
  if (options.json) return JSON.stringify(report, null, 2);
  return (options.outdated ? renderOutdated(report) : renderRiders(report)).join("\n");
}

export function renderRiders(report: RidersReport): string[] {
  const asOf = new Date(report.asOf);
  const newest = report.newest?.version ?? null;
  const lines = [
    heading("RIDER APP", "riders who used it today", `as of ${nepalTime(asOf)} NPT`),
    "",
  ];

  if (report.activeToday === 0) {
    lines.push("  No rider has used the app yet today.");
  } else {
    lines.push(paint("dim", formatRow(COLUMNS, ["App", "Riders", "Share"])));
    for (const row of report.apps) {
      const [label, note] = describe(row, newest);
      lines.push(
        formatRow(COLUMNS, [label, num(row.riders), percent(row.riders, report.activeToday)]) +
        `   ${bar(row.riders / report.activeToday, 24)}  ${note}`,
      );
    }
    lines.push(rule(38), paint("bold", formatRow(COLUMNS, ["Total", num(report.activeToday), "100%"])));
  }

  if (report.newest && report.progress.length > 0) {
    lines.push("", "  " + paint("bold", `How many Android riders have updated to ${report.newest.version}`));
    for (const p of report.progress) {
      const share = p.android > 0 ? p.onVersion / p.android : 0;
      lines.push(`  ${shortDay(p.day).padEnd(12)}${bar(share, 40)}  ${percent(p.onVersion, p.android).padStart(4)}` +
        paint("dim", `   ${num(p.onVersion)} of ${num(p.android)}`));
    }
  }

  lines.push("", "  " + paint("bold", "Still on an older Android app, by branch"));
  if (report.outdatedByBranch.length === 0) {
    lines.push("  None. Every Android rider has the latest version.");
  } else {
    lines.push("  " + report.outdatedByBranch.map((b) => `${b.branch} ${num(b.riders)}`).join(`   ${paint("dim", "·")}   `));
  }

  lines.push(
    "",
    paint("dim", `  ${num(report.online)} riders online now. ${num(Math.max(0, report.totalRiders - report.activeToday))} of ${num(report.totalRiders)} riders have not used the app today.`),
    paint("dim", "  Try: pm-stats riders --outdated   lists who still needs to update"),
  );
  return lines;
}

function describe(row: AppRow, newest: string | null): [string, string] {
  if (row.platform === "android") {
    if (row.version === null) return ["Android app, very old", paint("warn", "▲ please update")];
    return row.version === newest
      ? [`Android app ${row.version}`, paint("good", "● latest")]
      : [`Android app ${row.version}`, paint("warn", "▲ older version")];
  }
  if (row.platform === "web") return ["Web browser", paint("dim", "· updates itself when reopened")];
  if (row.platform === "ios") return [`iPhone app ${row.version ?? ""}`.trim(), ""];
  return ["Unknown", paint("dim", "· an older web app")];
}

export function renderOutdated(report: RidersReport): string[] {
  const asOf = new Date(report.asOf);
  const target = report.newest ? report.newest.version : "unknown";
  const lines = [
    heading("RIDERS TO UPDATE", `latest version: ${target}`, nepalDate(asOf), `as of ${nepalTime(asOf)} NPT`),
    "",
  ];
  const riders = report.outdated ?? [];
  if (riders.length === 0) return [...lines, "  Nobody. Every Android rider has the latest version."];

  const columns: Column[] = [{ width: 26, align: "left" }, { width: 26, align: "left" }, { width: 14, align: "left" }, { width: 18, align: "left" }];
  lines.push(paint("dim", formatRow(columns, ["Rider", "Branch", "App version", "Last used"])));
  for (const r of riders) {
    lines.push(formatRow(columns, [r.name, r.branch, r.version ?? "very old", nepalDayTime(new Date(r.lastSeen))]));
  }
  lines.push("", paint("dim", `  ${num(riders.length)} riders. Based on the app each one last used, in the past 30 days.`));
  return lines;
}
