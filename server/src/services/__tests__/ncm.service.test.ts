import { describe, it, expect } from "vitest";
import { matchNcmBranch } from "../ncm.service";

// Duplicates NcmBranch shape from ncm.service
type Branch = { name: string; district?: string; covered_areas?: string };

const BRANCHES_JHAPA_MULTI: Branch[] = [
  { name: "DAMAK", district: "Jhapa", covered_areas: "LAKHANPUR, JHILJHILE, BIRTAMODE" },
  { name: "BIRTAMODE", district: "Jhapa", covered_areas: "BIRTAMODE, CHANDRAGADHI" },
  { name: "BAHUNDANGI", district: "Jhapa", covered_areas: "BAHUNDANGI" },
];

const BRANCHES_DEMO_SINGLE: Branch[] = [
  { name: "DAMAK", district: "Jhapa", covered_areas: "LAKHANPUR, PANDAJUNGI" },
  { name: "BUTWAL", district: "Rupandehi" },
  { name: "TINKUNE", district: "Kathmandu" },
  { name: "POKHARA", district: "Kaski" },
];

const BRANCHES_COVERED: Branch[] = [
  { name: "DAMAK", district: "Jhapa", covered_areas: "JHILJHILE, BIRTAMODE" },
  { name: "HILE", district: "Dhankuta" },
];

describe("matchNcmBranch — regression: Jhiljhile must not match Hile/Bahundangi", () => {
  it("JHILJHILE (district Jhapa) must NOT match HILE via substring — not sync via token", () => {
    // Old bug: "JHILJHILE".includes("HILE") => true
    const dest = { name: "Jhiljhile", district: "Jhapa" as string | null };
    const branches: Branch[] = [
      { name: "HILE", district: "Dhankuta" },
      { name: "DAMAK", district: "Jhapa" },
    ];
    const m = matchNcmBranch(dest as any, branches as any);
    // With single Jhapa branch DAMAK, district tier returns DAMAK, not HILE
    expect(m?.name).toBe("DAMAK");
  });

  it("JHILJHILE vs HILE with no district — must not match via substring", () => {
    const dest = { name: "Jhiljhile", district: null };
    const branches: Branch[] = [
      { name: "HILE", district: "Dhankuta" },
      { name: "DAMAK", district: "Jhapa", covered_areas: "JHILJHILE" },
    ];
    const m = matchNcmBranch(dest as any, branches as any);
    // covered_areas exact match should pick DAMAK, not HILE
    expect(m?.name).toBe("DAMAK");
  });

  it("JHILJHILE (Jhapa) with multiple Jhapa branches — must NOT pick first Jhapa (BAHUNDANGI) via district", () => {
    const dest = { name: "Jhiljhile", district: "Jhapa" as string | null };
    const m = matchNcmBranch(dest as any, BRANCHES_JHAPA_MULTI as any);
    // District ambiguous (3 branches share Jhapa) => fall through.
    // No branch name equals JHILJHILE, but covered_areas of DAMAK does => DAMAK
    expect(m?.name).toBe("DAMAK");
  });

  it("unknown village in Jhapa with no covered_areas hit — district ambiguous => no match (needs override)", () => {
    const dest = { name: "SomeUnknownVillage", district: "Jhapa" as string | null };
    const m = matchNcmBranch(dest as any, BRANCHES_JHAPA_MULTI as any);
    expect(m).toBeUndefined();
  });

  it("override ncm_branch pins Jhiljhile to BIRTAMODE even when district ambiguous", () => {
    const dest = { name: "Jhiljhile", district: "Jhapa" as string | null, ncm_branch: "BIRTAMODE" } as any;
    const m = matchNcmBranch(dest, BRANCHES_JHAPA_MULTI as any);
    expect(m?.name).toBe("BIRTAMODE");
  });

  it("override to non-existent branch => no match (data error, don't fall through to wrong branch)", () => {
    const dest = { name: "Jhiljhile", district: "Jhapa" as string | null, ncm_branch: "NONEXISTENT" } as any;
    const m = matchNcmBranch(dest, BRANCHES_JHAPA_MULTI as any);
    expect(m).toBeUndefined();
  });

  it("demo: single Jhapa branch DAMAK — district tier returns DAMAK (not ambiguous)", () => {
    const dest = { name: "Jhiljhile", district: "Jhapa" as string | null };
    const m = matchNcmBranch(dest as any, BRANCHES_DEMO_SINGLE as any);
    expect(m?.name).toBe("DAMAK");
  });

  it("Pokhara Branch -> POKHARA via word-boundary token, not substring", () => {
    const dest = { name: "Pokhara Branch", district: null };
    const branches: Branch[] = [{ name: "POKHARA", district: "Kaski" }];
    const m = matchNcmBranch(dest as any, branches as any);
    expect(m?.name).toBe("POKHARA");
  });

  it("Jhiljhile - Jhapa (with dash suffix) still matches via covered_areas", () => {
    const dest = { name: "Jhiljhile - Jhapa", district: "Jhapa" as string | null };
    const branches: Branch[] = [{ name: "DAMAK", district: "Jhapa", covered_areas: "JHILJHILE" }];
    // In demo single-district case district tier would hit anyway; test multi to force covered_areas
    const multi: Branch[] = [
      { name: "DAMAK", district: "Jhapa", covered_areas: "JHILJHILE" },
      { name: "BIRTAMODE", district: "Jhapa" },
    ];
    const m = matchNcmBranch(dest as any, multi as any);
    expect(m?.name).toBe("DAMAK");
  });

  it("exact branch name match beats covered_areas", () => {
    const dest = { name: "DAMAK", district: "Jhapa" as string | null };
    const branches: Branch[] = [
      { name: "DAMAK", district: "Jhapa", covered_areas: "JHILJHILE" },
      { name: "BIRTAMODE", district: "Jhapa", covered_areas: "DAMAK" },
    ];
    const m = matchNcmBranch(dest as any, branches as any);
    // District ambiguous, so falls through, but exact name DAMAK wins before covered_areas check picks BIRTAMODE
    expect(m?.name).toBe("DAMAK");
  });

  it("district exact single match wins even when name differs", () => {
    const dest = { name: "Random Village", district: "Kaski" as string | null };
    const branches: Branch[] = [{ name: "POKHARA", district: "Kaski" }];
    const m = matchNcmBranch(dest as any, branches as any);
    expect(m?.name).toBe("POKHARA");
  });

  it("no destination => undefined", () => {
    expect(matchNcmBranch(null, BRANCHES_DEMO_SINGLE as any)).toBeUndefined();
    expect(matchNcmBranch(undefined, BRANCHES_DEMO_SINGLE as any)).toBeUndefined();
  });
});
