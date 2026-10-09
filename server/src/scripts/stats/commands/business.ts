import { type BusinessReport, getBusinessReport, type Measure } from "../../../services/analytics/queries/business";
import { bar, type Cell, type Column, formatRow, heading, nepalTime, npr, num, paint } from "../render";

export async function businessCommand(options: { json: boolean; branch: string | null }): Promise<string> {
  const report = await getBusinessReport(options.branch);
  return options.json ? JSON.stringify(report, null, 2) : renderBusiness(report).join("\n");
}

const COLUMNS: Column[] = [{ width: 16, align: "left" }, { width: 14 }, { width: 14 }, { width: 9 }, { width: 15 }];

// "▲ 8%" against the same time last week. upIsGood decides the colour only;
// the arrow always shows the direction.
export function change(m: Measure, upIsGood: boolean): Cell {
  if (m.lastWeek === 0) return m.today === 0 ? "–" : { text: "new", style: upIsGood ? "good" : "warn" };
  const pct = Math.round(((m.today - m.lastWeek) / m.lastWeek) * 100);
  if (pct === 0) return "0%";
  const up = pct > 0;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(pct)}%`, style: up === upIsGood ? "good" : "warn" };
}

export function renderBusiness(report: BusinessReport): string[] {
  const asOf = new Date(report.asOf);
  const time = nepalTime(asOf);
  const lines = [
    heading("BUSINESS", ...(report.branchFilter ? [report.branchFilter.join(", ")] : []), "today so far", `as of ${time} NPT`),
    "",
    paint("bold", formatRow(COLUMNS, ["", "Today", "Last week", "Change", "Yesterday"])),
    paint("dim", formatRow(COLUMNS, ["", `to ${time}`, `to ${time}`, "", "full day"])),
  ];

  const rows: [string, Measure, boolean, (n: number) => string][] = [
    ["Orders created", report.created, true, num],
    ["Picked up", report.pickedUp, true, num],
    ["Delivered", report.delivered, true, num],
    ["Returned", report.returned, false, num],
    ["Cancelled", report.cancelled, false, num],
    ["COD collected", report.codCollected, true, npr],
  ];
  for (const [label, m, upIsGood, format] of rows) {
    lines.push(formatRow(COLUMNS, [
      label, { text: format(m.today), style: "accent" }, format(m.lastWeek), change(m, upIsGood), format(m.yesterday),
    ]));
  }

  const finished = report.delivered.today + report.returned.today;
  lines.push(
    "",
    `  Success rate today       ${paint("bold", finished > 0 ? `${((report.delivered.today / finished) * 100).toFixed(1)}%` : "–")}` +
    paint("dim", "   of today's finished orders, how many were delivered (not returned)"),
    `  Right now                ${paint("bold", num(report.outForDelivery))} out for delivery` +
    paint("dim", `   ·   ${num(report.inProgress)} picked up and on the way`),
    "",
  );

  const branchColumns: Column[] = [{ width: 22, align: "left" }, { width: 8 }, { width: 11 }, { width: 10 }, { width: 17 }];
  lines.push(paint("bold", formatRow(branchColumns, ["Branch", "Orders", "Delivered", "Returned", "COD collected"])) +
    paint("dim", "   Share of orders"));
  const totalOrders = report.branches.reduce((sum, b) => sum + b.orders, 0);
  if (report.branches.length === 0) lines.push("  No orders yet today.");
  for (const b of report.branches.slice(0, 12)) {
    lines.push(formatRow(branchColumns, [
      b.branch.length > 21 ? `${b.branch.slice(0, 20)}…` : b.branch, num(b.orders), num(b.delivered), num(b.returned), npr(b.cod),
    ]) + `   ${bar(totalOrders > 0 ? b.orders / totalOrders : 0, 20)}`);
  }
  if (report.branches.length > 12) lines.push(paint("dim", `  + ${num(report.branches.length - 12)} more branches   ·   pm-stats business --branch <name>`));

  lines.push(
    "",
    paint("dim", "  Numbers match the dashboard. Branch = where the order was picked up."),
    paint("dim", "  COD = cash collected from today's deliveries. Cancelled orders are never counted."),
    paint("dim", "  Try: pm-stats business --branch Pokhara"),
  );
  return lines;
}
