// resolveBranchLocationIds is the one place "what counts as covered by
// branch X" gets decided - transit manifest destination checks, branch
// settlement eligibility, and branch orders/overview rollups all go through
// it. These lock down the virtual-coverage expansion added alongside it:
// a virtually-covered branch contributes itself and its own plain covered
// areas, one level only, without needing (or recursing into) its own
// virtual list.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: { locations: { findFirst: vi.fn() } },
}));
vi.mock("../order.service", () => ({ listOrders: vi.fn() }));
vi.mock("../pricing.service", () => ({ invalidateDestinationPricingCache: vi.fn() }));

import prisma from "../../lib/prisma";
import { resolveBranchLocationIds } from "../branch.service";

const mockedFindFirst = (prisma as unknown as { locations: { findFirst: ReturnType<typeof vi.fn> } })
  .locations.findFirst;

beforeEach(() => vi.clearAllMocks());

describe("resolveBranchLocationIds", () => {
  it("returns just the branch when it covers nothing", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "branch-a", other_locations: [], branch_virtual_coverage_branch: [],
    });

    expect(await resolveBranchLocationIds("branch-a")).toEqual(["branch-a"]);
  });

  it("folds in a virtually-covered branch's own id and its own covered areas", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "branch-a",
      other_locations: [{ id: "area-1" }],
      branch_virtual_coverage_branch: [
        {
          covered_branch: {
            id: "branch-b",
            other_locations: [{ id: "area-2" }, { id: "area-3" }],
          },
        },
      ],
    });

    expect(await resolveBranchLocationIds("branch-a")).toEqual([
      "branch-a", "area-1", "branch-b", "area-2", "area-3",
    ]);
  });

  it("404s when the branch doesn't exist or isn't an active hub", async () => {
    mockedFindFirst.mockResolvedValue(null);

    await expect(resolveBranchLocationIds("branch-x")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns undefined for no branch at all - nothing to scope by", async () => {
    expect(await resolveBranchLocationIds(undefined)).toBeUndefined();
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });
});
