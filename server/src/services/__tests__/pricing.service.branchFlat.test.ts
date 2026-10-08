// A branch vendor (hub = a branch like Hetauda) on the flat model is charged its
// own "Inside Hetauda" / "Outside Hetauda" rate, where inside means Hetauda's
// coverage - not the Kathmandu valley. No rate set means null, so order pricing
// falls back to Hetauda's route rates instead of failing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: {
    pricing_settings: { findFirst: vi.fn(), create: vi.fn() },
    locations: { findUnique: vi.fn() },
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn().mockResolvedValue(null), setex: vi.fn(), del: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/branchScope", () => ({ resolveBranchCoverageIds: vi.fn() }));

import { getBranchVendorFlatQuote } from "../pricing.service";
import prisma from "../../lib/prisma";
import { resolveBranchCoverageIds } from "../../lib/branchScope";

const mockedPrisma = prisma as unknown as {
  pricing_settings: { findFirst: ReturnType<typeof vi.fn> };
  locations: { findUnique: ReturnType<typeof vi.fn> };
};
const mockedCoverage = resolveBranchCoverageIds as unknown as ReturnType<typeof vi.fn>;

const HETAUDA = "hub-hetauda";
const HETAUDA_AREA = "area-hetauda-bazaar";
const POKHARA = "dest-pokhara";
const KTM = "dest-ktm";

function location(id: string, valley: string | null) {
  return {
    id, name: id, parent_id: null, zone: null, valley, ring_road: null,
    per_destination_rate: null, branch_per_destination_rate: null,
  };
}

const VENDOR = {
  flatInsideValley: 100, // "Inside Hetauda"
  flatOutsideValley: 250, // "Outside Hetauda"
  extraWeightPercent: 10,
  returnInsideValleyPercent: 0,
  returnOutsideValleyPercent: 50,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCoverage.mockResolvedValue([HETAUDA, HETAUDA_AREA]);
  mockedPrisma.pricing_settings.findFirst.mockResolvedValue({
    id: "s", free_weight_kg: 2, extra_weight_percent: null,
    return_inside_valley_percent: null, return_outside_valley_percent: null,
    branch_return_inside_valley_percent: null, branch_return_outside_valley_percent: null,
  });
  mockedPrisma.locations.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(location(where.id, where.id === KTM ? "inside" : "outside")),
  );
});

describe("getBranchVendorFlatQuote", () => {
  it("charges the inside rate for a destination in the branch's coverage", async () => {
    const quote = await getBranchVendorFlatQuote(HETAUDA, HETAUDA_AREA, 1, VENDOR, "home_delivery", false);
    expect(quote).toMatchObject({ baseCharge: 100, totalPayable: 100, insideBranch: true });
  });

  it("charges the outside rate everywhere else - keyed by coverage, not by valley", async () => {
    // KTM is inside the Kathmandu valley but outside Hetauda's coverage.
    const quote = await getBranchVendorFlatQuote(HETAUDA, KTM, 1, VENDOR, "home_delivery", false);
    expect(quote).toMatchObject({ baseCharge: 250, insideBranch: false });
  });

  it("lets the vendor's inside-valley flat rate win for Kathmandu-valley destinations", async () => {
    const quote = await getBranchVendorFlatQuote(
      HETAUDA, KTM, 1, { ...VENDOR, insideValleyFlatRate: 180 }, "home_delivery", false,
    );
    expect(quote?.baseCharge).toBe(180);
  });

  it("applies the extra-weight surcharge beyond the free weight", async () => {
    // 4kg - 2kg free = 2kg extra at 10% of 250 each.
    const quote = await getBranchVendorFlatQuote(HETAUDA, POKHARA, 4, VENDOR, "home_delivery", false);
    expect(quote).toMatchObject({ baseCharge: 250, weightSurcharge: 50, totalPayable: 300 });
  });

  it("uses the branch-delivery pair when set, else the plain inside/outside rate", async () => {
    const withPair = await getBranchVendorFlatQuote(
      HETAUDA, POKHARA, 1, { ...VENDOR, branchFlatOutsideValley: 200 }, "branch_delivery", false,
    );
    expect(withPair?.baseCharge).toBe(200);
    const withoutPair = await getBranchVendorFlatQuote(HETAUDA, POKHARA, 1, VENDOR, "branch_delivery", false);
    expect(withoutPair?.baseCharge).toBe(250);
  });

  it("prices a return at the inside/outside-branch return percent", async () => {
    const outside = await getBranchVendorFlatQuote(HETAUDA, POKHARA, 1, VENDOR, "home_delivery", true);
    expect(outside).toMatchObject({ totalPayable: 125, returnPercent: 50, baseDeliveryCharge: 250 });
    const inside = await getBranchVendorFlatQuote(HETAUDA, HETAUDA_AREA, 1, VENDOR, "home_delivery", true);
    expect(inside).toMatchObject({ totalPayable: 0, returnPercent: 0 });
  });

  it("returns null when the vendor has no rate for that side, so route pricing applies", async () => {
    const quote = await getBranchVendorFlatQuote(
      HETAUDA, POKHARA, 1, { flatInsideValley: 100 }, "home_delivery", false,
    );
    expect(quote).toBeNull();
  });

  it("returns null for an inactive branch rather than failing the order", async () => {
    mockedCoverage.mockRejectedValue(new AppError(404, "Branch not found or inactive"));
    const quote = await getBranchVendorFlatQuote(HETAUDA, POKHARA, 1, VENDOR, "home_delivery", false);
    expect(quote).toBeNull();
  });
});
