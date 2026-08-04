import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    pricing_settings: { findFirst: vi.fn(), create: vi.fn() },
    locations: { findUnique: vi.fn() },
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));

import { getVendorQuote, getReturnDeliveryQuote, VendorRateOverrides } from "../pricing.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";

const mockedPrisma = prisma as unknown as {
  pricing_settings: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  locations: { findUnique: ReturnType<typeof vi.fn> };
};
const mockedRedis = redis as unknown as {
  get: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

const DEST_ID = "dest-1";
const PARENT_ID = "parent-1";

// All Decimal-backed columns default to null, same as an unconfigured
// pricing_settings row - each test only sets the fields it cares about.
function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "settings-1",
    zone_major_cities: null,
    zone_urban_areas: null,
    zone_remote_areas: null,
    zone_inside_valley: null,
    flat_inside_valley: null,
    flat_outside_valley: null,
    branch_zone_major_cities: null,
    branch_zone_urban_areas: null,
    branch_zone_remote_areas: null,
    branch_zone_inside_valley: null,
    branch_flat_inside_valley: null,
    branch_flat_outside_valley: null,
    extra_weight_percent: null,
    free_weight_kg: 2,
    return_inside_valley_percent: null,
    return_outside_valley_percent: null,
    ...overrides,
  };
}

function baseLocation(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    parent_id: null,
    name: `Location ${id}`,
    zone: null,
    valley: null,
    per_destination_rate: null,
    branch_per_destination_rate: null,
    ...overrides,
  };
}

let locationsById: Record<string, ReturnType<typeof baseLocation>> = {};
function setLocation(id: string, overrides: Record<string, unknown> = {}) {
  locationsById[id] = baseLocation(id, overrides);
}

beforeEach(() => {
  vi.clearAllMocks();
  locationsById = {};
  // Caches off by default so every test exercises the real computation.
  mockedRedis.get.mockResolvedValue(null);
  mockedRedis.setex.mockResolvedValue("OK");
  mockedRedis.del.mockResolvedValue(1);
  mockedPrisma.pricing_settings.findFirst.mockImplementation(() =>
    Promise.resolve(baseSettings()),
  );
  mockedPrisma.locations.findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
    Promise.resolve(locationsById[id] ?? null),
  );
});

function useSettings(overrides: Record<string, unknown>) {
  mockedPrisma.pricing_settings.findFirst.mockResolvedValue(baseSettings(overrides));
}

describe("getVendorQuote - flat rate", () => {
  it("home delivery inside valley uses the global flat_inside_valley rate", async () => {
    useSettings({ flat_inside_valley: 100, flat_outside_valley: 175 });
    setLocation(DEST_ID, { valley: "inside" });
    const quote = await getVendorQuote("flat", DEST_ID, 1, {}, "home_delivery");
    expect(quote.baseCharge).toBe(100);
    expect(quote.basis).toBe("Flat home rate (inside valley)");
  });

  it("home delivery outside valley uses the global flat_outside_valley rate", async () => {
    useSettings({ flat_inside_valley: 100, flat_outside_valley: 175 });
    setLocation(DEST_ID, { valley: "outside" });
    const quote = await getVendorQuote("flat", DEST_ID, 1, {}, "home_delivery");
    expect(quote.baseCharge).toBe(175);
  });

  it("branch delivery uses the global branch_flat_* rate when set", async () => {
    useSettings({ flat_inside_valley: 100, branch_flat_inside_valley: 120 });
    setLocation(DEST_ID, { valley: "inside" });
    const quote = await getVendorQuote("flat", DEST_ID, 1, {}, "branch_delivery");
    expect(quote.baseCharge).toBe(120);
    expect(quote.basis).toBe("Flat branch rate (inside valley)");
  });

  it("branch delivery falls back to the home rate when branch_flat_* is null", async () => {
    useSettings({ flat_inside_valley: 100, branch_flat_inside_valley: null });
    setLocation(DEST_ID, { valley: "inside" });
    const quote = await getVendorQuote("flat", DEST_ID, 1, {}, "branch_delivery");
    expect(quote.baseCharge).toBe(100);
  });

  it("a vendor's home flat override wins over the global setting", async () => {
    useSettings({ flat_inside_valley: 100 });
    setLocation(DEST_ID, { valley: "inside" });
    const overrides: VendorRateOverrides = { flatInsideValley: 250 };
    const quote = await getVendorQuote("flat", DEST_ID, 1, overrides, "home_delivery");
    expect(quote.baseCharge).toBe(250);
  });

  it("a vendor's branch flat override wins over the global branch setting", async () => {
    useSettings({ branch_flat_inside_valley: 120 });
    setLocation(DEST_ID, { valley: "inside" });
    const overrides: VendorRateOverrides = { branchFlatInsideValley: 300 };
    const quote = await getVendorQuote("flat", DEST_ID, 1, overrides, "branch_delivery");
    expect(quote.baseCharge).toBe(300);
  });

  it("the cross-model insideValleyFlatRate override applies for home delivery regardless of rate type", async () => {
    useSettings({ zone_major_cities: 155 });
    setLocation(DEST_ID, { valley: "inside", zone: "major_cities" });
    const overrides: VendorRateOverrides = { insideValleyFlatRate: 90 };
    const quote = await getVendorQuote("zone", DEST_ID, 1, overrides, "home_delivery");
    expect(quote.baseCharge).toBe(90);
    expect(quote.basis).toBe("Flat inside-valley rate");
  });

  it("the cross-model insideValleyFlatRate override is ignored for branch delivery", async () => {
    useSettings({ zone_major_cities: 155, branch_zone_major_cities: 200 });
    setLocation(DEST_ID, { valley: "inside", zone: "major_cities" });
    const overrides: VendorRateOverrides = { insideValleyFlatRate: 90 };
    const quote = await getVendorQuote("zone", DEST_ID, 1, overrides, "branch_delivery");
    expect(quote.baseCharge).toBe(200);
  });

  it("throws when the destination has no valley classification", async () => {
    setLocation(DEST_ID, { valley: null });
    await expect(getVendorQuote("flat", DEST_ID, 1, {}, "home_delivery")).rejects.toThrow(
      /not classified inside\/outside valley/,
    );
  });
});

describe("getVendorQuote - zone rate", () => {
  it.each([
    ["major_cities", "zone_major_cities", 155],
    ["urban_areas", "zone_urban_areas", 170],
    ["remote_areas", "zone_remote_areas", 190],
    ["inside_valley", "zone_inside_valley", 100],
  ] as const)("home delivery zone=%s uses %s", async (zone, settingsField, value) => {
    useSettings({ [settingsField]: value });
    setLocation(DEST_ID, { zone });
    const quote = await getVendorQuote("zone", DEST_ID, 1, {}, "home_delivery");
    expect(quote.baseCharge).toBe(value);
  });

  it("a vendor's zone override wins over the global setting", async () => {
    useSettings({ zone_major_cities: 155 });
    setLocation(DEST_ID, { zone: "major_cities" });
    const overrides: VendorRateOverrides = { zoneMajorCities: 210 };
    const quote = await getVendorQuote("zone", DEST_ID, 1, overrides, "home_delivery");
    expect(quote.baseCharge).toBe(210);
  });

  it("branch delivery uses the global branch zone rate when set", async () => {
    useSettings({ zone_major_cities: 155, branch_zone_major_cities: 175 });
    setLocation(DEST_ID, { zone: "major_cities" });
    const quote = await getVendorQuote("zone", DEST_ID, 1, {}, "branch_delivery");
    expect(quote.baseCharge).toBe(175);
  });

  it("a vendor's branch zone override wins over the global branch setting", async () => {
    useSettings({ branch_zone_major_cities: 175 });
    setLocation(DEST_ID, { zone: "major_cities" });
    const overrides: VendorRateOverrides = { branchZoneMajorCities: 220 };
    const quote = await getVendorQuote("zone", DEST_ID, 1, overrides, "branch_delivery");
    expect(quote.baseCharge).toBe(220);
  });

  it("branch delivery falls back to the home zone rate when the branch value is null", async () => {
    useSettings({ zone_major_cities: 155, branch_zone_major_cities: null });
    setLocation(DEST_ID, { zone: "major_cities" });
    const quote = await getVendorQuote("zone", DEST_ID, 1, {}, "branch_delivery");
    expect(quote.baseCharge).toBe(155);
  });

  it("throws when the destination has no zone assigned", async () => {
    setLocation(DEST_ID, { zone: null });
    await expect(getVendorQuote("zone", DEST_ID, 1, {}, "home_delivery")).rejects.toThrow(
      /not assigned to a zone/,
    );
  });

  it("throws when the destination's zone has no rate configured", async () => {
    useSettings({ zone_remote_areas: null });
    setLocation(DEST_ID, { zone: "remote_areas" });
    await expect(getVendorQuote("zone", DEST_ID, 1, {}, "home_delivery")).rejects.toThrow(
      /No home rate set for zone "remote_areas"/,
    );
  });
});

describe("getVendorQuote - per-destination rate", () => {
  it("home delivery uses the destination's own per_destination_rate", async () => {
    setLocation(DEST_ID, { per_destination_rate: 199 });
    const quote = await getVendorQuote("per_destination", DEST_ID, 1, {}, "home_delivery");
    expect(quote.baseCharge).toBe(199);
    expect(quote.basis).toContain("Per-destination home rate");
  });

  it("branch delivery uses the destination's branch_per_destination_rate when set", async () => {
    setLocation(DEST_ID, { per_destination_rate: 199, branch_per_destination_rate: 149 });
    const quote = await getVendorQuote("per_destination", DEST_ID, 1, {}, "branch_delivery");
    expect(quote.baseCharge).toBe(149);
  });

  it("branch delivery falls back to the home per-destination rate when the branch rate is null", async () => {
    setLocation(DEST_ID, { per_destination_rate: 199, branch_per_destination_rate: null });
    const quote = await getVendorQuote("per_destination", DEST_ID, 1, {}, "branch_delivery");
    expect(quote.baseCharge).toBe(199);
  });

  it("falls back to the parent location's rate for a covered area with no rate of its own", async () => {
    setLocation(PARENT_ID, { per_destination_rate: 199, branch_per_destination_rate: 149 });
    setLocation(DEST_ID, {
      parent_id: PARENT_ID,
      per_destination_rate: null,
      branch_per_destination_rate: null,
    });
    const home = await getVendorQuote("per_destination", DEST_ID, 1, {}, "home_delivery");
    expect(home.baseCharge).toBe(199);
    const branch = await getVendorQuote("per_destination", DEST_ID, 1, {}, "branch_delivery");
    expect(branch.baseCharge).toBe(149);
  });

  it("throws when neither the destination nor its parent has a rate configured", async () => {
    setLocation(PARENT_ID, { per_destination_rate: null });
    setLocation(DEST_ID, { parent_id: PARENT_ID, per_destination_rate: null });
    await expect(getVendorQuote("per_destination", DEST_ID, 1, {}, "home_delivery")).rejects.toThrow(
      /No per-destination home rate set/,
    );
  });
});

describe("getVendorQuote - weight surcharge", () => {
  it("charges no surcharge at or under the free weight threshold", async () => {
    useSettings({ flat_inside_valley: 100, free_weight_kg: 2, extra_weight_percent: 50 });
    setLocation(DEST_ID, { valley: "inside" });
    const quote = await getVendorQuote("flat", DEST_ID, 2, {}, "home_delivery");
    expect(quote.weightSurcharge).toBe(0);
    expect(quote.totalPayable).toBe(100);
  });

  it("charges extraKg * (rate * extraWeightPercent/100) above the free weight threshold", async () => {
    useSettings({ flat_inside_valley: 100, free_weight_kg: 2, extra_weight_percent: 50 });
    setLocation(DEST_ID, { valley: "inside" });
    const quote = await getVendorQuote("flat", DEST_ID, 5, {}, "home_delivery");
    // extraKg = 3, surcharge = 3 * (100 * 0.5) = 150
    expect(quote.weightSurcharge).toBe(150);
    expect(quote.totalPayable).toBe(250);
  });

  it("a vendor's extraWeightPercent override wins over the global setting", async () => {
    useSettings({ flat_inside_valley: 100, free_weight_kg: 2, extra_weight_percent: 50 });
    setLocation(DEST_ID, { valley: "inside" });
    const overrides: VendorRateOverrides = { extraWeightPercent: 10 };
    const quote = await getVendorQuote("flat", DEST_ID, 5, overrides, "home_delivery");
    // extraKg = 3, surcharge = 3 * (100 * 0.1) = 30
    expect(quote.weightSurcharge).toBe(30);
    expect(quote.totalPayable).toBe(130);
  });
});

describe("getReturnDeliveryQuote", () => {
  it("charges 0 when the global return percent for the valley side is 0", async () => {
    useSettings({ flat_inside_valley: 100, return_inside_valley_percent: 0 });
    setLocation(DEST_ID, { valley: "inside" });
    const quote = await getReturnDeliveryQuote("flat", DEST_ID, 1, {}, "home_delivery");
    expect(quote.baseDeliveryCharge).toBe(100);
    expect(quote.returnPercent).toBe(0);
    expect(quote.totalPayable).toBe(0);
  });

  it("charges the configured percent of the base delivery charge for the outside-valley leg", async () => {
    useSettings({ flat_outside_valley: 175, return_outside_valley_percent: 50 });
    setLocation(DEST_ID, { valley: "outside" });
    const quote = await getReturnDeliveryQuote("flat", DEST_ID, 1, {}, "home_delivery");
    expect(quote.baseDeliveryCharge).toBe(175);
    expect(quote.returnPercent).toBe(50);
    expect(quote.totalPayable).toBe(87.5);
  });

  it("a vendor's return percent override wins over the global setting", async () => {
    useSettings({ flat_outside_valley: 175, return_outside_valley_percent: 50 });
    setLocation(DEST_ID, { valley: "outside" });
    const overrides: VendorRateOverrides = { returnOutsideValleyPercent: 20 };
    const quote = await getReturnDeliveryQuote("flat", DEST_ID, 1, overrides, "home_delivery");
    expect(quote.returnPercent).toBe(20);
    expect(quote.totalPayable).toBe(35);
  });

  it("defaults to 0% when the destination's valley side is unclassified", async () => {
    useSettings({ zone_major_cities: 155 });
    setLocation(DEST_ID, { zone: "major_cities", valley: null });
    const quote = await getReturnDeliveryQuote("zone", DEST_ID, 1, {}, "home_delivery");
    expect(quote.returnPercent).toBe(0);
    expect(quote.totalPayable).toBe(0);
  });
});
