import { emitKeypressEvents } from "node:readline";
import type Redis from "ioredis";
import { type ApiReport, getApiReport, percentileMs } from "../../../services/analytics/queries/api";
import { type BusinessReport, getBusinessReport } from "../../../services/analytics/queries/business";
import { getRidersReport, type RidersReport } from "../../../services/analytics/queries/riders";
import { getUsersReport, lastDays, type UsersReport } from "../../../services/analytics/queries/users";
import { getVendorsReport, type VendorsReport } from "../../../services/analytics/queries/vendors";
import { formatMs } from "./api";
import { change } from "./business";
import { vendorAttention } from "./vendors";
import {
  bar, type Cell, fitVisible, nepalDate, nepalTime, npr, num, paint, shortDay, sparkline, type Style, visibleLength,
} from "../render";

// Traffic and server health are cheap Redis/OS reads; the rest queries
// Postgres, so it refreshes less often to stay light on production.
const FAST_MS = 5_000;
const SLOW_MS = 30_000;
// Below this many columns the panels stack instead of sitting side by side.
const GRID_MIN_WIDTH = 110;
const GRID_MAX_WIDTH = 150;

export type LiveState = {
  at: string;
  api: ApiReport;
  users: UsersReport;
  riders: RidersReport;
  business: BusinessReport;
  vendors: VendorsReport;
  error: string | null;
  paused?: boolean;
};

type Alert = { level: Style; text: string };

export function liveAlerts(state: LiveState): Alert[] {
  const alerts: Alert[] = [];
  const { overall } = state.api.summary;
  const { server } = state.api;
  if (state.api.redisError || !server.redis.ok) alerts.push({ level: "bad", text: "Cache (Redis) is down: traffic numbers are missing" });
  if (overall.requests >= 50 && overall.errors / overall.requests >= 0.02) {
    alerts.push({ level: "bad", text: `${((overall.errors / overall.requests) * 100).toFixed(1)}% of requests failed in the last hour` });
  }
  const slow = percentileMs(overall.buckets, 0.95);
  if (slow !== null && slow > 2000) alerts.push({ level: "warn", text: `The site is slow: 5% of requests take ${formatMs(slow)}+` });
  if (server.diskUsedPct !== null && server.diskUsedPct >= 80) alerts.push({ level: "warn", text: `Disk is ${server.diskUsedPct}% full` });
  if (!server.db) alerts.push({ level: "bad", text: "Database is unreachable" });
  else if (server.db.inUse >= server.db.max * 0.8) {
    alerts.push({ level: "warn", text: `Database is busy: ${server.db.inUse} of ${server.db.max} connections in use` });
  }
  for (const item of vendorAttention(state.vendors)) alerts.push({ level: item.level, text: `${item.who}: ${item.text}` });
  const outdated = state.riders.outdatedByBranch.reduce((sum, b) => sum + b.riders, 0);
  if (outdated > 0) alerts.push({ level: "warn", text: `${num(outdated)} riders need to update the app (pm-stats riders --outdated)` });
  return alerts;
}

function cellText(cell: Cell): string {
  return typeof cell === "string" ? cell : paint(cell.style, cell.text);
}

const dot = `  ${paint("dim", "·")}  `;
const icon = (level: Style) => paint(level, level === "bad" ? "✕" : level === "good" ? "●" : "▲");

type Panel = { title: string; lines: string[] };

// Counting starts the day pm-stats ships, so until it has a week (or a month)
// of history the 7- and 30-day numbers equal today's. Say how far back the
// count goes instead of showing three identical numbers.
export function usedOverTime(users: UsersReport): string {
  const since = users.trackingSince;
  const [monthStart] = lastDays(users.today, 30);
  const [weekStart] = lastDays(users.today, 7);
  const day = (d: string) => shortDay(d).replace(/ \d{4}$/, "");
  const all = users.groups.all;
  if (!since || since >= users.today) return paint("dim", "Counting began today.");
  if (since > weekStart!) return `Since ${day(since)}: ${num(all.last30Days)}` + paint("dim", "  (counting began then)");
  if (since > monthStart!) return `Last 7 days ${num(all.last7Days)}${dot}since ${day(since)} ${num(all.last30Days)}`;
  return `Last 7 days ${num(all.last7Days)}${dot}last 30 days ${num(all.last30Days)}`;
}

// Each panel's lines, shared by the grid and the stacked layout. `width` is
// the space inside the panel, for bars and the traffic trend.
function panels(state: LiveState, width: number): Record<string, Panel> {
  const { overall, series } = state.api.summary;
  const { server } = state.api;
  const u = state.users.groups;
  const b = state.business;
  const errorRate = overall.requests > 0 ? `${((overall.errors / overall.requests) * 100).toFixed(1)}%` : "–";
  const meter = (name: string, used: number | null, total: string) =>
    `${name.padEnd(10)}${bar((used ?? 0) / 100, 20)}  ${total}`;

  const apps = state.riders.apps;
  const latest = state.riders.newest?.version ?? null;
  const count = (keep: (a: (typeof apps)[number]) => boolean) => apps.filter(keep).reduce((s, a) => s + a.riders, 0);
  // An app that sent no version is never "latest", even before any rider has
  // an app that reports one.
  const isLatest = (a: (typeof apps)[number]) => latest !== null && a.version === latest;
  const onLatest = count((a) => a.platform === "android" && isLatest(a));
  const older = count((a) => a.platform === "android" && !isLatest(a));
  const browser = Math.max(0, state.riders.activeToday - onLatest - older);
  const riderBar = (name: string, n: number) =>
    `${name.padEnd(14)}${bar(state.riders.activeToday ? n / state.riders.activeToday : 0, 16)}  ${num(n).padStart(4)}`;

  const errors = state.api.recentErrors.slice(0, 4);
  const alerts = liveAlerts(state);

  return {
    users: {
      title: "USERS",
      lines: [
        `${paint("accent", paint("bold", num(u.all.online)))} online now`,
        `Staff ${num(u.staff.online)}${dot}Vendors ${num(u.vendor.online)}${dot}Riders ${num(u.rider.online)}`,
        `Used it today ${num(u.all.today)}`,
        usedOverTime(state.users),
      ],
    },
    traffic: {
      title: "TRAFFIC · LAST HOUR",
      lines: [
        `${paint("bold", num(Math.round(overall.requests / 60)))} requests a minute${dot}typical ${formatMs(percentileMs(overall.buckets, 0.5))}` +
        `${dot}slow 5% ${formatMs(percentileMs(overall.buckets, 0.95))}${dot}errors ${errorRate}`,
        paint("accent", sparkline(series).slice(-Math.max(10, width))),
        paint("dim", "1 hour ago".padEnd(Math.max(10, Math.min(series.length, width)) - 3) + "now"),
      ],
    },
    server: {
      title: "SERVER",
      lines: [
        meter("CPU", server.loadPct, `${server.loadPct}%`),
        meter("Memory", server.memoryUsedPct, `${server.memoryUsedPct}%`),
        meter("Disk", server.diskUsedPct, server.diskUsedPct === null ? "–" : `${server.diskUsedPct}%`),
        server.db
          ? meter("Database", (server.db.inUse / server.db.max) * 100, `${server.db.inUse}/${server.db.max}`)
          : `Database  ${paint("bad", "✕ unreachable")}`,
        `Cache     ${server.redis.ok ? paint("good", "● ok") : paint("bad", "✕ down")}`,
      ],
    },
    riders: {
      title: "RIDER APP",
      lines: [
        riderBar(latest ? `App ${latest}` : "Latest app", onLatest),
        riderBar("Older app", older) + (older > 0 ? ` ${paint("warn", "▲")}` : ""),
        riderBar("Web browser", browser),
        paint("dim", `${num(state.riders.activeToday)} used it today  ·  ${num(state.riders.online)} online`),
      ],
    },
    business: {
      title: "BUSINESS TODAY",
      lines: [
        `${"Orders".padEnd(14)}${num(b.created.today).padStart(13)}  ${cellText(change(b.created, true))}`,
        `${"Delivered".padEnd(14)}${num(b.delivered.today).padStart(13)}  ${cellText(change(b.delivered, true))}`,
        `${"Returned".padEnd(14)}${num(b.returned.today).padStart(13)}  ${cellText(change(b.returned, false))}`,
        `${"COD collected".padEnd(14)}${npr(b.codCollected.today).padStart(13)}  ${cellText(change(b.codCollected, true, npr))}`,
        paint("dim", `${num(b.outForDelivery)} out for delivery  ·  ▲▼ vs last week`),
      ],
    },
    errors: {
      title: "LATEST SERVER ERRORS",
      lines: errors.length === 0
        ? [`${paint("good", "●")} None recorded.`]
        : [
          paint("dim", `${"Time".padEnd(7)}${"Code".padEnd(6)}Request`),
          ...errors.map((e) => `${nepalTime(new Date(e.at)).padEnd(7)}${paint("bad", String(e.status).padEnd(6))}${e.method} ${e.route}`),
        ],
    },
    alerts: {
      title: "ALERTS",
      lines: alerts.length === 0
        ? [`${paint("good", "●")} All clear`]
        : [...alerts.slice(0, 4).map((a) => `${icon(a.level)} ${a.text}`),
          ...(alerts.length > 4 ? [paint("dim", `+ ${alerts.length - 4} more`)] : [])],
    },
  };
}

// A box with its title in the top edge. `width` includes the borders.
function box(panel: Panel, width: number, height: number): string[] {
  const inner = width - 4;
  const title = ` ${panel.title} `;
  const top = paint("dim", "╭─") + paint("accent", title) + paint("dim", `${"─".repeat(Math.max(0, width - 3 - title.length))}╮`);
  const body = Array.from({ length: height }, (_, i) =>
    `${paint("dim", "│")} ${fitVisible(panel.lines[i] ?? "", inner)} ${paint("dim", "│")}`);
  return [top, ...body, paint("dim", `╰${"─".repeat(width - 2)}╯`)];
}

// Boxes side by side, all as tall as the tallest.
function row(cells: { panel: Panel; width: number }[]): string[] {
  const height = Math.max(...cells.map((c) => c.panel.lines.length));
  const boxes = cells.map((c) => box(c.panel, c.width, height));
  return boxes[0]!.map((_, i) => boxes.map((lines) => lines[i]).join(" "));
}

export function renderLive(state: LiveState, columns = 140): string[] {
  const at = new Date(state.at);
  const width = Math.min(columns, GRID_MAX_WIDTH);
  const status = state.paused ? paint("warn", "paused") : `updates every ${FAST_MS / 1000} s`;
  const left = `${paint("bold", "pm-stats live")}${dot}${nepalDate(at)}  ${nepalTime(at)} NPT${dot}${status}`;
  const keys = paint("dim", "q quit   p pause   r refresh now");
  const header = left + " ".repeat(Math.max(3, width - visibleLength(left) - visibleLength(keys))) + keys;
  const footer = state.error ? ["", paint("bad", `✕ Last update failed: ${state.error}. Showing the previous numbers.`)] : [];

  if (width < GRID_MIN_WIDTH) {
    const p = panels(state, width - 4);
    const stacked = [p.users, p.traffic, p.server, p.riders, p.business, p.alerts, p.errors]
      .flatMap((panel) => ["", paint("accent", panel!.title), ...panel!.lines.map((l) => `  ${l}`)]);
    return [left, keys, ...stacked, ...footer];
  }

  const col = Math.floor((width - 2) / 3);
  const wide = col * 2 + 1;
  const p = panels(state, wide - 4);
  return [
    header,
    "",
    ...row([{ panel: p.users!, width: col }, { panel: p.traffic!, width: wide }]),
    ...row([{ panel: p.server!, width: col }, { panel: p.riders!, width: col }, { panel: p.business!, width: col }]),
    // Alerts get the wide panel: they are what someone has to act on.
    ...row([{ panel: p.alerts!, width: wide }, { panel: p.errors!, width: col }]),
    ...footer,
  ];
}

// Terminal control: the alternate screen is the full-screen mode top/htop use,
// so redraws replace the screen instead of piling up in the scroll history.
const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

// One full redraw: home the cursor, overwrite each line (clearing whatever
// the previous frame left to its right), then clear anything below. Never
// taller or wider than the window, so the terminal never scrolls.
export function frame(lines: string[], rows: number, columns: number): string {
  const room = Math.max(1, rows - 1);
  const shown = lines.length > room
    ? [...lines.slice(0, room - 1), paint("warn", `▼ ${lines.length - room + 1} more lines: make the window taller to see everything`)]
    : lines;
  return `\x1b[H${shown.map((line) => clip(line, columns)).join("\x1b[K\r\n")}\x1b[K\x1b[J`;
}

function clip(line: string, columns: number): string {
  return visibleLength(line) > columns ? fitVisible(line, columns) : line;
}

export async function liveCommand(redis: Redis): Promise<void> {
  const loadFast = () => getApiReport(redis, "1h");
  const loadSlow = async () => {
    const [users, riders, business, vendors] = await Promise.all([
      getUsersReport(7), getRidersReport({ listOutdated: false }), getBusinessReport(), getVendorsReport(redis),
    ]);
    return { users, riders, business, vendors };
  };

  const [api, slow] = await Promise.all([loadFast(), loadSlow()]);
  let state: LiveState = { at: new Date().toISOString(), api, ...slow, error: null, paused: false };

  const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  if (!interactive) {
    // Piped: print once.
    process.stdout.write(`${renderLive(state, process.stdout.columns || 140).join("\n")}\n`);
    return;
  }

  const draw = () => {
    // One spare column: some terminals wrap a line that touches the right edge.
    const columns = (process.stdout.columns || 141) - 1;
    process.stdout.write(frame(renderLive(state, columns), process.stdout.rows || 40, columns));
  };
  // Whatever happens, hand the terminal back as it was.
  const restore = () => process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
  process.once("exit", restore);
  process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE + "\x1b[2J");
  draw();

  const refresh = async (includeSlow: boolean) => {
    try {
      const [fresh, freshSlow] = await Promise.all([loadFast(), includeSlow ? loadSlow() : Promise.resolve(null)]);
      state = { ...state, ...(freshSlow ?? {}), api: fresh, at: new Date().toISOString(), error: null };
    } catch (error) {
      state = { ...state, at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    }
    draw();
  };

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  // A resize can leave pieces of the old frame where the new one won't reach.
  const redrawAll = () => {
    process.stdout.write("\x1b[2J");
    draw();
  };
  process.stdout.on("resize", redrawAll);

  await new Promise<void>((resolve) => {
    const fast = setInterval(() => { if (!state.paused) void refresh(false); }, FAST_MS);
    const slowTimer = setInterval(() => { if (!state.paused) void refresh(true); }, SLOW_MS);
    const stop = () => {
      clearInterval(fast);
      clearInterval(slowTimer);
      process.stdout.off("resize", redrawAll);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.off("exit", restore);
      restore();
      resolve();
    };
    process.stdin.on("keypress", (_text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) stop();
      else if (key.name === "r") void refresh(true);
      else if (key.name === "p") {
        state = { ...state, paused: !state.paused };
        draw();
      }
    });
  });
}
