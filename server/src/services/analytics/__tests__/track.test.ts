import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma", () => ({
  default: { $executeRaw: vi.fn() },
  pool: {},
}));

import prisma from "../../../lib/prisma";
import { recordUserActivity, resetActivityThrottle } from "../track";

const executeRaw = prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("recordUserActivity", () => {
  beforeEach(() => {
    resetActivityThrottle();
    executeRaw.mockReset();
    executeRaw.mockResolvedValue(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes at most once a minute per person", async () => {
    recordUserActivity("user-1", ["admin"]);
    recordUserActivity("user-1", ["admin"]);
    recordUserActivity("user-2", ["rider"]);
    await flush();
    expect(executeRaw).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-10-09T08:00:59Z"));
    recordUserActivity("user-1", ["admin"]);
    await flush();
    expect(executeRaw).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-10-09T08:01:00Z"));
    recordUserActivity("user-1", ["admin"]);
    await flush();
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it("stores the person's group and app, not their roles", async () => {
    recordUserActivity("user-2", ["admin", "rider"], { platform: "android", version: "1.4.3" });
    recordUserActivity("user-3", ["vendor_staff"]);
    await flush();
    expect(executeRaw.mock.calls.map((call) => call.slice(1))).toEqual([
      ["user-2", "rider", "android", "1.4.3"],
      ["user-3", "vendor", null, null],
    ]);
  });

  it("never throws or rejects when the database write fails", async () => {
    executeRaw.mockRejectedValue(new Error("connection refused"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => recordUserActivity("user-1", ["admin"])).not.toThrow();
    await flush();

    expect(logged).toHaveBeenCalledWith("[Analytics] Failed to record user activity:", expect.any(Error));
  });
});
