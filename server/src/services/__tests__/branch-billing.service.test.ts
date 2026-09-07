import { describe, expect, it, vi } from "vitest";

// The transition gate uses this pure classifier after it has calculated the
// branch's unsettled COD and verified credits. Keeping the edge rules covered
// here protects the threshold contract independently of database fixtures.
vi.mock("../../lib/prisma", () => ({ default: {} }));
vi.mock("../billing.service", () => ({ getBillingSettings: vi.fn() }));

import { branchStateForBalance } from "../branch-billing.service";

describe("branchStateForBalance", () => {
  const thresholds = { warnThreshold: -50_000, blockThreshold: -75_000 };

  it("keeps a branch clear above its warning threshold", () => {
    expect(branchStateForBalance(-49_999.99, thresholds)).toBe("ok");
  });

  it("warns at the remittance warning threshold", () => {
    expect(branchStateForBalance(-50_000, thresholds)).toBe("warned");
  });

  it("blocks exactly at the transit block threshold", () => {
    expect(branchStateForBalance(-75_000, thresholds)).toBe("blocked");
  });
});
