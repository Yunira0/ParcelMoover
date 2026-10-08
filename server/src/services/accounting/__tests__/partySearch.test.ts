import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("../../../lib/prisma", () => ({ default: { $queryRaw: queryRaw } }));

import { searchParties, searchPartiesPage } from "../accounting.service";
import { partySearchQuerySchema } from "../../../validators/accounting.schema";

const party = (partyType: "rider" | "vendor" | "user", n: number) => ({
  partyType,
  partyId: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  name: `Person ${n}`,
  subtitle: null,
});

describe("accounting party lookup", () => {
  beforeEach(() => queryRaw.mockReset());

  it("accepts an empty query for paged browsing and validates the type scope", () => {
    expect(partySearchQuerySchema.safeParse({ paged: "true", q: "", types: "rider,vendor,user" }).success).toBe(true);
    expect(partySearchQuerySchema.safeParse({ q: "" }).success).toBe(false);
    expect(partySearchQuerySchema.safeParse({ paged: "true", types: "customer" }).success).toBe(false);
    expect(partySearchQuerySchema.safeParse({ paged: "true", limit: "1000" }).success).toBe(false);
  });

  it("returns one bounded page with a continuation flag across all three party kinds", async () => {
    queryRaw.mockResolvedValue([party("rider", 1), party("vendor", 2), party("user", 3)]);
    const page = await searchPartiesPage("", ["rider", "vendor", "user"], 0, 2);
    expect(page).toEqual({ results: [party("rider", 1), party("vendor", 2)], hasMore: true });
    const sql = queryRaw.mock.calls[0]![0];
    expect(sql.strings.join(" ")).toContain("FROM users");
    expect(sql.strings.join(" ")).toContain("NOT EXISTS");
    expect(sql.strings.join(" ")).toContain("FROM riders");
    expect(sql.strings.join(" ")).toContain("FROM vendors");
    expect(sql.values).toContain(3);
  });

  it("does not search disallowed party tables for a control account", async () => {
    queryRaw.mockResolvedValue([party("vendor", 2)]);
    expect(await searchPartiesPage("Acme", ["vendor"], 30, 30)).toEqual({
      results: [party("vendor", 2)], hasMore: false,
    });
    const sql = queryRaw.mock.calls[0]![0];
    expect(sql.strings.join(" ")).toContain("FROM vendors");
    expect(sql.strings.join(" ")).not.toContain("FROM riders");
    expect(sql.strings.join(" ")).not.toContain("FROM users");
    expect(sql.values).toContain("%Acme%");
    expect(sql.values).toContain(30);
  });

  it("keeps the existing search-only response empty for short queries", async () => {
    expect(await searchParties("a")).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
