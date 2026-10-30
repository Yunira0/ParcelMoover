// Terminal output for pm-stats: colours, aligned columns, bars, sparklines.
// Layouts follow the pm-stats design canvas. Colour is never the only signal:
// every coloured state also carries a symbol or a word, so --no-color output
// reads the same.

export type Style = "dim" | "bold" | "accent" | "good" | "warn" | "bad";

const CODES: Record<Style, string> = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  accent: "\x1b[38;5;208m",
  good: "\x1b[32m",
  warn: "\x1b[33m",
  bad: "\x1b[31m",
};

let colorEnabled = false;

export function configureColor(enabled: boolean): void {
  colorEnabled = enabled;
}

export function paint(style: Style, text: string): string {
  return colorEnabled && text ? `${CODES[style]}${text}\x1b[0m` : text;
}

// A cell is plain text or text with a style. Widths count the text only, so
// colour codes never break alignment.
export type Cell = string | { text: string; style: Style };
export type Column = { width: number; align?: "left" | "right" };

export function formatRow(columns: Column[], cells: Cell[], indent = 2): string {
  const parts = columns.map((column, i) => {
    const cell = cells[i] ?? "";
    const text = typeof cell === "string" ? cell : cell.text;
    const padded = column.align === "left" ? text.padEnd(column.width) : text.padStart(column.width);
    return typeof cell === "string" ? padded : paint(cell.style, padded);
  });
  return " ".repeat(indent) + parts.join("").trimEnd();
}

const ANSI = /\x1b\[[0-9;]*m/g;

// Width as the terminal shows it: colour codes take no space.
export function visibleLength(text: string): number {
  return text.replace(ANSI, "").length;
}

// Pad to exactly `width` visible characters, cutting with "…" if too long.
export function fitVisible(text: string, width: number): string {
  const length = visibleLength(text);
  if (length <= width) return text + " ".repeat(width - length);
  return text.replace(ANSI, "").slice(0, width - 1) + "…";
}

export function rule(width: number, indent = 2): string {
  return " ".repeat(indent) + paint("dim", "─".repeat(width));
}

export function heading(title: string, ...details: string[]): string {
  return paint("bold", title) + paint("dim", details.map((d) => `  ·  ${d}`).join(""));
}

// A bar of `width` cells, filled to `fraction` (0-1).
export function bar(fraction: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return paint("accent", "█".repeat(filled)) + paint("dim", "░".repeat(width - filled));
}

const SPARKS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return values
    .map((v) => SPARKS[high === low ? (high === 0 ? 0 : 3) : Math.round(((v - low) / (high - low)) * 7)])
    .join("");
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}

// Nepali grouping: NPR 18,42,300
export function npr(amount: number): string {
  return `NPR ${Math.round(amount).toLocaleString("en-IN")}`;
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

const NEPAL = "Asia/Kathmandu";

// "Fri 9 Oct 2026"
export function nepalDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NEPAL, weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
}

// "14:32"
export function nepalTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: NEPAL, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

// "9 Oct, 14:32"
export function nepalDayTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: NEPAL, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

// "9 Oct 2026" from YYYY-MM-DD
export function shortDay(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(`${day}T00:00:00Z`));
}
