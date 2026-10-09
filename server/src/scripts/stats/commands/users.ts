import { USER_GROUPS, type UserGroup } from "../../../services/analytics/groups";
import { getUsersReport, lastDays, type UsersReport } from "../../../services/analytics/queries/users";
import {
  bar, type Column, formatRow, heading, nepalDate, nepalTime, num, paint, percent, rule, shortDay, sparkline,
} from "../render";

const LABELS: Record<UserGroup | "all", string> = { staff: "Staff", vendor: "Vendors", rider: "Riders", all: "All" };

const COLUMNS: Column[] = [
  { width: 8, align: "left" }, { width: 8 }, { width: 8 }, { width: 9 }, { width: 10 }, { width: 9 },
];
const TABLE_WIDTH = 71;

export const MAX_DAYS = 90;

export async function usersCommand(options: { json: boolean; days: number }): Promise<string> {
  const report = await getUsersReport(options.days);
  return options.json ? JSON.stringify(report, null, 2) : renderUsers(report).join("\n");
}

export function renderUsers(report: UsersReport): string[] {
  const asOf = new Date(report.asOf);
  const days = report.trend.days.length;
  const lines = [
    heading("USERS", nepalDate(asOf), `as of ${nepalTime(asOf)} NPT`),
    "",
    paint("dim", formatRow(COLUMNS, ["", "Online", "Today", "7 days", "30 days", "Total"]) + "    Used it in 30 days"),
  ];

  for (const group of [...USER_GROUPS, "all"] as const) {
    const n = report.groups[group];
    const share = n.total > 0 ? Math.min(1, n.last30Days / n.total) : 0;
    const text = formatRow(COLUMNS, [
      LABELS[group], num(n.online), group === "all" ? num(n.today) : { text: num(n.today), style: "accent" },
      num(n.last7Days), num(n.last30Days), num(n.total),
    ]) + `    ${bar(share, 10)} ${percent(Math.min(n.last30Days, n.total), n.total).padStart(4)}`;
    if (group === "all") lines.push(rule(TABLE_WIDTH), paint("bold", text));
    else lines.push(text);
  }

  lines.push(
    "",
    "  " + paint("bold", `People per day, last ${days} days`.padEnd(9 + days + 3)) + paint("dim", " low  high"),
  );
  for (const group of USER_GROUPS) {
    const values = report.trend[group];
    lines.push(
      `  ${LABELS[group].padEnd(9)}${paint("accent", sparkline(values))}   ` +
      `${num(Math.min(...values)).padStart(4)}  ${num(Math.max(...values)).padStart(4)}`,
    );
  }

  const v = report.newVendors;
  const notSeen = (group: UserGroup) => num(Math.max(0, report.groups[group].total - report.groups[group].last30Days));
  const dot = paint("dim", "·");
  lines.push(
    "",
    `  New vendor sign-ups    today ${num(v.today)}   ${dot}   7 days ${num(v.last7Days)}   ${dot}   30 days ${num(v.last30Days)}`,
    `  Not seen in 30 days    staff ${notSeen("staff")}   ${dot}   vendors ${notSeen("vendor")}   ${dot}   riders ${notSeen("rider")}`,
    "",
    paint("dim", "  Online = using it now (last 5 minutes). Today / 7 days / 30 days = different people who used it."),
  );

  const windowStart = lastDays(report.today, 30)[0]!;
  if (!report.trackingSince || report.trackingSince > windowStart) {
    lines.push(paint("warn", report.trackingSince
      ? `  Counting started on ${shortDay(report.trackingSince)}, so the 7- and 30-day numbers are still filling in.`
      : "  Nobody has been counted yet. Numbers appear after the first person logs in."));
  }
  lines.push(paint("dim", `  Try: pm-stats users --days ${MAX_DAYS}   ·   pm-stats users --json`));
  return lines;
}
