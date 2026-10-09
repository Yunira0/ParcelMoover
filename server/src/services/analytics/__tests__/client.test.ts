import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { readAppClient } from "../client";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

describe("readAppClient", () => {
  it("reads the rider app's platform and version", () => {
    expect(readAppClient(req({ "x-app-platform": "android", "x-app-version": "1.4.3" })))
      .toEqual({ platform: "android", version: "1.4.3" });
    expect(readAppClient(req({ "x-app-platform": "Web", "x-app-version": " 1.4.3 " })))
      .toEqual({ platform: "web", version: "1.4.3" });
  });

  it("recognises older APKs by their WebView origin, version unknown", () => {
    expect(readAppClient(req({ origin: "https://localhost" }))).toEqual({ platform: "android", version: null });
  });

  it("reports nothing for the dashboard", () => {
    expect(readAppClient(req({ origin: "https://portal.parcelmoover.com" }))).toEqual({ platform: null, version: null });
  });

  it("ignores malformed values instead of storing them", () => {
    expect(readAppClient(req({ "x-app-platform": "<script>", "x-app-version": "1.4.3-beta; drop" })))
      .toEqual({ platform: null, version: null });
    expect(readAppClient(req({ "x-app-platform": "android", "x-app-version": "999.0.0" })))
      .toEqual({ platform: "android", version: null });
  });
});
