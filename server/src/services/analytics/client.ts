// Which app a request came from, for pm-stats riders.
//
// The rider app sends X-App-Platform and X-App-Version on every request.
// APKs built before that still identify as Android through the Capacitor
// WebView's origin (androidScheme https => https://localhost); their version is
// unknown. Anything malformed is ignored rather than stored.

import type { Request } from "express";

export type AppClient = { platform: string | null; version: string | null };

const PLATFORMS = new Set(["android", "ios", "web"]);
const VERSION = /^\d{1,2}\.\d{1,2}\.\d{1,2}$/;
const CAPACITOR_ANDROID_ORIGIN = "https://localhost";

export function readAppClient(req: Request): AppClient {
  const platformHeader = header(req, "x-app-platform")?.toLowerCase();
  const versionHeader = header(req, "x-app-version");
  const platform = platformHeader && PLATFORMS.has(platformHeader)
    ? platformHeader
    : req.headers.origin === CAPACITOR_ANDROID_ORIGIN ? "android" : null;
  const version = versionHeader && VERSION.test(versionHeader) ? versionHeader : null;
  return { platform, version };
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value.trim() : undefined;
}
