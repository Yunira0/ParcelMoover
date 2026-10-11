import type Redis from "ioredis";
import { getVendorsReport, type KeyRow, type VendorsReport, type WebhookHealth } from "../../../services/analytics/queries/vendors";
import { type Column, formatRow, heading, nepalDayTime, nepalTime, num, paint } from "../render";

const STATUS_WORDS: Record<string, string> = {
  "400": "bad request", "401": "key rejected", "403": "not allowed", "404": "not found",
  "409": "conflict", "413": "too large", "422": "invalid order data", "429": "rate limited",
};

export type Attention = { level: "warn" | "bad"; who: string; text: string };

// More than about 1 call in 33 failing is worth a look; overall it is usually ~1%.
const FAILING_SHARE = 0.03;

export async function vendorsCommand(redis: Redis, options: { json: boolean; all: boolean }): Promise<string> {
  const report = await getVendorsReport(redis);
  return options.json ? JSON.stringify(report, null, 2) : renderVendors(report, options.all).join("\n");
}

const SHOWN = 15;

export function renderVendors(report: VendorsReport, all = false): string[] {
  const asOf = new Date(report.asOf);
  const lines = [heading("PARTNER API", "today", `as of ${nepalTime(asOf)} NPT`), ""];
  if (report.redisError) {
    lines.push(paint("bad", `  ✕ Could not read the call counts: the cache (Redis) is unreachable (${report.redisError})`), "");
  }

  const active = report.keys.filter((k) => k.calls > 0);
  const calls = active.reduce((sum, k) => sum + k.calls, 0);
  const failed = active.reduce((sum, k) => sum + k.failed, 0);
  const vendors = new Set(active.map((k) => k.vendorId ?? k.keyId)).size;
  const dot = paint("dim", "·");
  lines.push(
    `  ${paint("bold", num(vendors))} vendors called the API today   ${dot}   ${paint("bold", num(calls))} calls   ${dot}   ` +
    `${paint("bold", calls > 0 ? `${((failed / calls) * 100).toFixed(1)}%` : "–")} failed`,
    "",
  );

  const columns: Column[] = [
    { width: 22, align: "left" }, { width: 18, align: "left" }, { width: 7 }, { width: 9 }, { width: 12 },
  ];
  if (active.length > 0) {
    lines.push(paint("dim", formatRow(columns, ["Vendor", "Key", "Calls", "Failed", "Last call"]) + "   Webhooks"));
    for (const key of all ? active : active.slice(0, SHOWN)) {
      const share = key.failed / key.calls;
      lines.push(formatRow(columns, [
        truncate(key.vendor, 21), `${key.keyPrefix}…`, num(key.calls),
        share >= FAILING_SHARE ? { text: `${(share * 100).toFixed(1)}% ▲`, style: "warn" } : `${(share * 100).toFixed(1)}%`,
        key.lastCallAt ? nepalTime(new Date(key.lastCallAt)) : "–",
      ]) + `   ${webhookCell(report.webhooks.find((w) => w.vendorId === key.vendorId))}`);
    }
    if (!all && active.length > SHOWN) {
      lines.push(paint("dim", `  + ${num(active.length - SHOWN)} more vendors   ·   pm-stats vendors --all`));
    }
  } else {
    lines.push("  No Partner API calls yet today.");
  }

  const attention = vendorAttention(report);
  lines.push("", paint("accent", "  Needs attention"));
  if (attention.length === 0) lines.push(`  ${paint("good", "●")} Nothing needs attention.`);
  for (const item of attention) {
    lines.push(`  ${paint(item.level, item.level === "bad" ? "✕" : "▲")} ${truncate(item.who, 20).padEnd(20)} ${item.text}`);
  }
  lines.push(
    "",
    paint("dim", "  Failed = we rejected the call or it hit an error. Webhooks = order updates we send to the vendor."),
  );
  return lines;
}

function webhookCell(w: WebhookHealth | undefined): string {
  if (!w) return paint("dim", "– none today");
  const failing = w.retrying + w.failed;
  if (failing > 0) return paint("bad", `✕ ${num(failing)} failing${w.lastFailureCode ? ` (HTTP ${w.lastFailureCode})` : ""}`);
  return paint("good", `● ${num(w.delivered)} delivered`);
}

const QUIET_AFTER_MS = 2 * 3_600_000;
const BUSY_YESTERDAY = 50;

export function vendorAttention(report: VendorsReport): Attention[] {
  const now = new Date(report.asOf).getTime();
  const items: Attention[] = [];

  for (const key of report.keys) {
    if (key.calls >= 20 && key.failed / key.calls >= FAILING_SHARE) {
      const top = topStatus(key);
      items.push({
        level: "warn", who: key.vendor,
        text: `${num(key.failed)} of ${num(key.calls)} calls failed today.${top ? ` Most are ${top}.` : ""}`,
      });
    }
    const lastCall = key.lastCallAt ? Date.parse(key.lastCallAt) : 0;
    if (key.yesterdayCalls >= BUSY_YESTERDAY && now - lastCall > QUIET_AFTER_MS && !key.revoked) {
      items.push({
        level: "warn", who: key.vendor,
        text: `No calls since ${lastCall ? nepalDayTime(new Date(lastCall)) : "yesterday"}. Yesterday it made ${num(key.yesterdayCalls)}.`,
      });
    }
  }

  for (const w of report.webhooks) {
    const failing = w.retrying + w.failed;
    if (failing === 0) continue;
    const since = w.failingSince ? ` since ${nepalTime(new Date(w.failingSince))}` : "";
    const last = w.lastFailureCode ? `HTTP ${w.lastFailureCode}` : "no response";
    items.push({ level: "bad", who: w.vendor, text: `${num(failing)} webhook deliveries failing${since} (last: ${last}).` });
  }

  for (const d of report.disabledEndpoints) {
    items.push({
      level: "bad", who: d.vendor,
      text: `Webhook "${d.name}" was turned off after repeated failures (${nepalDayTime(new Date(d.disabledAt))}).`,
    });
  }
  return items;
}

function topStatus(key: KeyRow): string | null {
  const [code] = Object.entries(key.statuses).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!code) return null;
  const word = STATUS_WORDS[code] ?? (code.startsWith("5") ? "server errors" : null);
  return word ? `${code}: ${word}` : code;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
