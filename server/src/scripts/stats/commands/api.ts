import type Redis from "ioredis";
import {
  API_WINDOWS, type ApiReport, type ApiWindow, getApiReport, percentileMs, type Totals,
} from "../../../services/analytics/queries/api";
import type { ServerStats } from "../../../services/analytics/queries/server";
import { nepalDay, TRAFFIC_APPS, type TrafficApp } from "../../../services/analytics/trafficKeys";
import {
  type Column, formatRow, heading, nepalDayTime, nepalTime, num, paint, shortDay, sparkline,
} from "../render";

const APP_LABELS: Record<TrafficApp, string> = { dashboard: "Dashboard", rider: "Rider app", partner: "Partner API" };
const SLOW_MS = 1000;
const MAX_SPARK = 60;

export async function apiCommand(redis: Redis, options: { json: boolean; window: ApiWindow }): Promise<string> {
  const report = await getApiReport(redis, options.window);
  return options.json
    ? JSON.stringify(report, (_key, value) => (value === Infinity ? ">5000" : value), 2)
    : renderApi(report).join("\n");
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "–";
  if (ms === Infinity) return ">5 s";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function errorRate(t: Totals): string {
  return t.requests > 0 ? `${((t.errors / t.requests) * 100).toFixed(1)}%` : "–";
}

function errorStatus(t: Totals): string {
  const rate = t.requests > 0 ? t.errors / t.requests : 0;
  if (rate >= 0.02) return paint("bad", "✕ too high");
  if (rate >= 0.005) return paint("warn", "▲ keep an eye on it");
  return paint("good", "● ok");
}

export function renderApi(report: ApiReport): string[] {
  const asOf = new Date(report.asOf);
  const from = new Date(report.from);
  const { label, slots, slotMs } = API_WINDOWS[report.window];
  const range = report.window === "7d"
    ? `${shortDay(nepalDay(from))} – ${shortDay(nepalDay(asOf))}`
    : `${nepalTime(from)}–${nepalTime(asOf)} NPT`;
  const lines = [heading("API TRAFFIC", label, range), ""];

  if (report.redisError) {
    lines.push(paint("bad", `  ✕ Could not read the request counts: the cache (Redis) is unreachable (${report.redisError})`), "");
  }

  const { overall, apps, routes, series } = report.summary;
  const minutes = (slots * slotMs) / 60_000;
  const left = `${num(overall.requests)}   ${paint("dim", "·")}   ${num(Math.round(overall.requests / minutes))} a minute`;
  const leftWidth = `${num(overall.requests)}   ·   ${num(Math.round(overall.requests / minutes))} a minute`.length;
  lines.push(
    `  ${paint("dim", "Requests".padEnd(12))}${left}${" ".repeat(Math.max(2, 30 - leftWidth))}` +
    `${paint("dim", "Server errors".padEnd(15))}${errorRate(overall).padStart(5)}   ${errorStatus(overall)}`,
    `  ${paint("dim", "Speed".padEnd(12))}typical ${formatMs(percentileMs(overall.buckets, 0.5))}   ${paint("dim", "·")}   ` +
    `slow 5% ${paint("bold", formatMs(percentileMs(overall.buckets, 0.95)))}`,
    "",
  );

  if (overall.requests === 0) {
    lines.push("  No requests counted in this time yet.", "");
  } else {
    const group = Math.ceil(series.length / MAX_SPARK);
    const grouped = chunkSums(series, group);
    const unit = report.window === "1h" ? "minute" : group === 1 ? "hour" : `${group} hours`;
    const title = `Requests per ${unit}`;
    lines.push(
      "  " + paint("bold", title) + paint("dim", `busiest ${num(Math.max(...grouped))}`.padStart(grouped.length - title.length)),
      "  " + paint("accent", sparkline(grouped)),
      "  " + paint("dim", axis(grouped.length, from, asOf, report.window)),
      "",
    );

    const appColumns: Column[] = [{ width: 16, align: "left" }, { width: 10 }, { width: 9 }, { width: 10 }, { width: 8 }];
    lines.push(paint("dim", formatRow(appColumns, ["App", "Requests", "Share", "Slow 5%", "Errors"])));
    for (const app of [...TRAFFIC_APPS].sort((a, b) => apps[b].requests - apps[a].requests)) {
      const t = apps[app];
      if (t.requests === 0) continue;
      lines.push(formatRow(appColumns, [
        APP_LABELS[app], num(t.requests), `${Math.round((t.requests / overall.requests) * 100)}%`,
        formatMs(percentileMs(t.buckets, 0.95)), errorRate(t),
      ]));
    }

    const minCalls = report.window === "1h" ? 20 : 50;
    const slowest = routes
      .filter((r) => r.requests >= minCalls)
      .map((r) => ({ ...r, p95: percentileMs(r.buckets, 0.95) ?? 0 }))
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, 5);
    lines.push("", paint("dim", `  ${"Slowest requests".padEnd(38)}${"Calls".padStart(8)}${"Slow 5%".padStart(10)}  ${"Errors".padStart(8)}`));
    if (slowest.length === 0) lines.push(paint("dim", `  Not enough requests yet to rank them (each needs ${minCalls}+).`));
    for (const r of slowest) {
      const slow = r.p95 > SLOW_MS;
      lines.push(
        `  ${truncate(r.route, 37).padEnd(38)}${num(r.requests).padStart(8)}` +
        (slow ? paint("warn", `${formatMs(r.p95).padStart(10)} ▲`) : `${formatMs(r.p95).padStart(10)}  `) +
        errorRate(r).padStart(8),
      );
    }
    lines.push("");
  }

  lines.push(serverLine(report.server));

  if (report.recentErrors.length > 0) {
    lines.push("", "  " + paint("bold", "Latest server errors"));
    for (const e of report.recentErrors.slice(0, 5)) {
      lines.push(`  ${paint("dim", nepalDayTime(new Date(e.at)).padEnd(15))}${paint("bad", String(e.status))}   ${e.method} ${e.route}`);
    }
  }

  lines.push(
    "",
    paint("dim", "  Slow 5% = 5 in every 100 requests take this long or longer. ▲ = over 1 second."),
    paint("dim", "  Errors = requests the server failed. Counts start over if the cache (Redis) restarts."),
    paint("dim", "  Try: pm-stats api --last 24h   ·   --last 7d"),
  );
  return lines;
}

export function serverLine(s: ServerStats): string {
  return `  ${paint("bold", "Server")}   ${serverSummary(s)}`;
}

export function serverSummary(s: ServerStats): string {
  const dot = `   ${paint("dim", "·")}   `;
  const parts = [
    `CPU ${s.loadPct}%`,
    `Memory ${s.memoryUsedPct}%`,
    s.diskUsedPct === null ? "Disk –" : s.diskUsedPct >= 80 ? paint("warn", `Disk ${s.diskUsedPct}% ▲`) : `Disk ${s.diskUsedPct}%`,
    s.db ? `Database ${num(s.db.inUse)} / ${num(s.db.max)} connections` : paint("bad", "Database ✕ unreachable"),
    `Cache ${s.redis.ok ? paint("good", "● ok") : paint("bad", "✕ down")}`,
  ];
  return parts.join(dot);
}

function chunkSums(values: number[], size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
  return out;
}

function axis(width: number, from: Date, to: Date, window: ApiWindow): string {
  const label = (d: Date) => (window === "7d" ? shortDay(nepalDay(d)).replace(/ \d{4}$/, "") : nepalTime(d));
  const mid = new Date((from.getTime() + to.getTime()) / 2);
  const [a, b, c] = [label(from), label(mid), label(to)];
  if (width < a.length + b.length + c.length + 4) return a.padEnd(width - c.length) + c;
  const midStart = Math.round(width / 2 - b.length / 2);
  return a.padEnd(midStart) + b.padEnd(width - midStart - c.length) + c;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
