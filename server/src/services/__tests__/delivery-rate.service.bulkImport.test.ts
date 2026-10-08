// bulkImportDeliveryRates resolves each row's free-text origin/destination
// against a hub OR one of its covered areas. Hub names/codes are globally
// unique so those always resolve unambiguously; a covered area's *name* is
// only unique within its own hub, so these lock down the disambiguation
// rules (code match, "<hub> / <area>" composite, and the ambiguous/unique
// bare-name cases) rather than silently picking the wrong branch's area.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    admins: { findFirst: vi.fn() },
    locations: { findMany: vi.fn() },
    delivery_rates: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

import { bulkImportDeliveryRates } from "../delivery-rate.service";
import prisma from "../../lib/prisma";

const mockedPrisma = prisma as unknown as {
  locations: { findMany: ReturnType<typeof vi.fn> };
  delivery_rates: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
};

const SUPER_ADMIN = { id: "root-1", roles: ["super_admin"] };

const HETAUDA = { id: "hub-hetauda", name: "Hetauda", code: "HET", parent_id: null };
const POKHARA = { id: "hub-pokhara", name: "Pokhara", code: "PKR", parent_id: null };
const IMADOL = { id: "hub-imadol", name: "Imadol", code: "IMD", parent_id: null };
// Same area name ("Chowk") under two different hubs - the ambiguous case.
const HETAUDA_CHOWK = { id: "area-het-chowk", name: "Chowk", code: null, parent_id: HETAUDA.id };
const POKHARA_CHOWK = { id: "area-pkr-chowk", name: "Chowk", code: "PKR-CHOWK", parent_id: POKHARA.id };
// Unique area name - resolvable bare.
const LAKESIDE = { id: "area-pkr-lakeside", name: "Lakeside", code: null, parent_id: POKHARA.id };

const ALL_LOCATIONS = [HETAUDA, POKHARA, IMADOL, HETAUDA_CHOWK, POKHARA_CHOWK, LAKESIDE];

function baseRow(overrides: Partial<{ origin: string; destination: string }> = {}) {
  return {
    origin: "Hetauda",
    destination: "Imadol",
    baseCharge: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.locations.findMany.mockResolvedValue(ALL_LOCATIONS);
  mockedPrisma.delivery_rates.findUnique.mockResolvedValue(null);
  mockedPrisma.delivery_rates.upsert.mockResolvedValue({});
});

describe("bulkImportDeliveryRates location resolution", () => {
  it("still resolves plain hub name/code rows as before", async () => {
    const results = await bulkImportDeliveryRates(SUPER_ADMIN, [baseRow()]);
    expect(results[0]).toMatchObject({ origin: "Hetauda", destination: "Imadol", action: "created" });
  });

  it("resolves a covered area by its globally-unique code", async () => {
    const results = await bulkImportDeliveryRates(
      SUPER_ADMIN,
      [baseRow({ origin: "PKR-CHOWK", destination: "Imadol" })],
    );
    expect(results[0]).toMatchObject({ origin: "Chowk", action: "created" });
    const call = mockedPrisma.delivery_rates.upsert.mock.calls[0]![0];
    expect(call.create.origin_location_id).toBe(POKHARA_CHOWK.id);
  });

  it("resolves a covered area via the '<hub> / <area>' composite form", async () => {
    const results = await bulkImportDeliveryRates(
      SUPER_ADMIN,
      [baseRow({ origin: "Hetauda / Chowk", destination: "Imadol" })],
    );
    expect(results[0]).toMatchObject({ origin: "Chowk", action: "created" });
    const call = mockedPrisma.delivery_rates.upsert.mock.calls[0]![0];
    expect(call.create.origin_location_id).toBe(HETAUDA_CHOWK.id);
  });

  it("resolves a bare area name that is unique across the network", async () => {
    const results = await bulkImportDeliveryRates(
      SUPER_ADMIN,
      [baseRow({ origin: "Hetauda", destination: "Lakeside" })],
    );
    expect(results[0]).toMatchObject({ destination: "Lakeside", action: "created" });
  });

  it("rejects a bare area name that collides across hubs, with a disambiguation hint", async () => {
    const results = await bulkImportDeliveryRates(
      SUPER_ADMIN,
      [baseRow({ origin: "Chowk", destination: "Imadol" })],
    );
    expect(results[0]!.error).toMatch(/more than one destination/i);
    expect(results[0]!.error).toMatch(/Hetauda, Pokhara|Pokhara, Hetauda/);
    expect(mockedPrisma.delivery_rates.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown '<hub> / <area>' pair", async () => {
    const results = await bulkImportDeliveryRates(
      SUPER_ADMIN,
      [baseRow({ origin: "Hetauda / Nowhere", destination: "Imadol" })],
    );
    expect(results[0]!.error).toMatch(/does not match/i);
  });

  it("rejects an unknown plain reference", async () => {
    const results = await bulkImportDeliveryRates(
      SUPER_ADMIN,
      [baseRow({ origin: "Neverland", destination: "Imadol" })],
    );
    expect(results[0]!.error).toMatch(/does not match/i);
  });
});
