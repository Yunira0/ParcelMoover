import { MAX_DAYS } from "./commands/users";
import { paint } from "./render";

const HELP_TEXT = `pm-stats - ParcelMoover numbers in your terminal

USAGE
  pm-stats <command> [options]

COMMANDS
  users       Who uses the system: online now, today, this week, this month
  riders      Rider app: Android app or web browser, and which version
  api         Server traffic: requests, speed, errors, and server health
  vendors     Partner API: calls per vendor, failures, and webhooks
  business    Today's orders, deliveries, returns and COD
  live        Everything on one screen, updated every 5 seconds

OPTIONS
  --days <n>       users: days in the trend, 1-${MAX_DAYS} (default 30)
  --outdated       riders: list who still needs to update the app
  --last <time>    api: 1h, 24h or 7d (default 1h)
  --all            vendors: list every vendor, not just the top 15
  --branch <name>  business: only orders from one branch, e.g. Pokhara
  --json           Raw numbers for scripts
  --no-color       Plain text, for pasting into chat

EXAMPLES
  pm-stats users --days 90
  pm-stats api --last 24h
  pm-stats vendors --json | jq '.keys[0]'

Times are Nepal time (NPT). People are counted by user ID only.`;

// Headings in bold, command and option names highlighted (plain with --no-color).
export function helpText(): string {
  let section = "";
  return HELP_TEXT.split("\n").map((line, i) => {
    if (i === 0) return paint("bold", "pm-stats") + paint("dim", line.slice("pm-stats".length));
    if (/^[A-Z]+$/.test(line)) {
      section = line;
      return paint("bold", line);
    }
    const match = line.match(/^( {2})(\S+(?: <[a-z]+>)?)( +)(.*)$/);
    if (match && (section === "COMMANDS" || section === "OPTIONS")) {
      const [, indent, name, gap, rest] = match;
      return `${indent}${paint("accent", name!)}${gap}${section === "OPTIONS" ? paint("dim", rest!) : rest}`;
    }
    return section === "" || line.startsWith("Times") ? paint("dim", line) : line;
  }).join("\n");
}
