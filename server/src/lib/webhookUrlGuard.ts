import { lookup } from "dns/promises";
import { isIP } from "net";
import { AppError } from "../utils/AppError";

// Vendor-supplied webhook URLs are untrusted input that the server will make
// outbound requests to — classic SSRF surface (a vendor could point a "store
// webhook" at http://169.254.169.254/ or an internal service). This checks
// scheme + resolved IP at registration time. It does not pin the resolved IP
// for the actual delivery request later (no custom fetch agent for that), so
// it's DNS-rebinding-aware at registration but not per-dispatch — a
// reasonable v1 tradeoff, not a full mitigation.

function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata (169.254.169.254)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped
    return false;
  }
  return true; // not a resolvable IP at all — reject
}

export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError(400, "Webhook URL must be a valid URL");
  }

  const isLocalDevException =
    process.env.NODE_ENV !== "production" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

  if (parsed.protocol !== "https:" && !isLocalDevException) {
    throw new AppError(400, "Webhook URL must use https://");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new AppError(400, "Webhook URL must use http:// or https://");
  }

  if (isLocalDevException) return;

  let addresses: string[];
  try {
    const result = await lookup(parsed.hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new AppError(400, "Webhook URL host could not be resolved");
  }

  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    throw new AppError(400, "Webhook URL must not resolve to a private or reserved address");
  }
}
