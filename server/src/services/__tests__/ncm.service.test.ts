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
    // District alone must not route the parcel to DAMAK.
    expect(m).toBeUndefined();
  });

  it("JHILJHILE vs HILE with no district — must not match via substring", () => {
    const dest = { name: "Jhiljhile", district: null };
    const branches: Branch[] = [
      { name: "HILE", district: "Dhankuta" },
      { name: "DAMAK", district: "Jhapa", covered_areas: "JHILJHILE" },
    ];
    const m = matchNcmBranch(dest as any, branches as any);
    // A covered-area match without a destination district is unsafe.
    expect(m).toBeUndefined();
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

  it("single branch in a district is not enough when destination does not match", () => {
    const dest = { name: "Jhiljhile", district: "Jhapa" as string | null };
    const m = matchNcmBranch(dest as any, BRANCHES_DEMO_SINGLE as any);
    expect(m).toBeUndefined();
  });

  it("does not use a branch-name token as a fallback", () => {
    const dest = { name: "Pokhara Branch", district: null };
    const branches: Branch[] = [{ name: "POKHARA", district: "Kaski" }];
    const m = matchNcmBranch(dest as any, branches as any);
    expect(m).toBeUndefined();
  });

  it("allows an exact branch-name match without a district", () => {
    const dest = { name: "Pokhara", district: null };
    const branches: Branch[] = [{ name: "POKHARA", district: "Kaski" }];

    expect(matchNcmBranch(dest as any, branches as any)?.name).toBe("POKHARA");
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

  it("Kerabari Morang must not match a covered area named Kerabari in Bandipur", () => {
    const dest = { name: "KERABARI - MORANG", district: "MORANG" as string | null };
    const branches: Branch[] = [
      // NCM currently returns BANDIPUR before the correct branch, and its
      // Tanahu coverage list happens to contain another KERABARI.
      { name: "BANDIPUR", district: "TANAHU", covered_areas: "GURDUM, KERABARI, KHAREY" },
      { name: "DAMAULI", district: "TANAHU", covered_areas: "BHATGAUN, KERABARI" },
      { name: "BELBARI", district: "MORANG", covered_areas: "KANEPOKHARI" },
      { name: "KERABARI MORANG", district: "MORANG", covered_areas: "BAGAICHHA, AMJUNGI" },
    ];

    const m = matchNcmBranch(dest as any, branches as any);
    expect(m?.name).toBe("KERABARI MORANG");
  });

  it("covered-area fallback never crosses a known destination district", () => {
    const dest = { name: "DUPLICATE PLACE - MORANG", district: "MORANG" as string | null };
    const branches: Branch[] = [
      { name: "WRONG", district: "TANAHU", covered_areas: "DUPLICATE PLACE" },
      { name: "MORANG HUB A", district: "MORANG", covered_areas: "SOMEWHERE ELSE" },
      { name: "MORANG HUB B", district: "MORANG", covered_areas: "ANOTHER PLACE" },
    ];

    expect(matchNcmBranch(dest as any, branches as any)).toBeUndefined();
  });

  it("district exact single match does not win when destination differs", () => {
    const dest = { name: "Random Village", district: "Kaski" as string | null };
    const branches: Branch[] = [{ name: "POKHARA", district: "Kaski" }];
    const m = matchNcmBranch(dest as any, branches as any);
    expect(m).toBeUndefined();
  });

  it("ambiguous same-district covered-area matches are ignored", () => {
    const dest = { name: "Shared Place - Jhapa", district: "Jhapa" as string | null };
    const branches: Branch[] = [
      { name: "DAMAK", district: "Jhapa", covered_areas: "SHARED PLACE" },
      { name: "BIRTAMODE", district: "Jhapa", covered_areas: "SHARED PLACE" },
    ];

    expect(matchNcmBranch(dest as any, branches as any)).toBeUndefined();
  });

  it("no destination => undefined", () => {
    expect(matchNcmBranch(null, BRANCHES_DEMO_SINGLE as any)).toBeUndefined();
    expect(matchNcmBranch(undefined, BRANCHES_DEMO_SINGLE as any)).toBeUndefined();
  });
});

describe("matchNcmBranch — regression: Khalanga/Darchula must not book to Amargadhi/Dadeldhura", () => {
  // Real prod incident (NCM order #25301800): our "Khalanga - Darchula" hub
  // (district Darchula) was routed to NCM's AMARGADHI branch (district
  // Dadeldhura) because AMARGADHI's covered_areas list contains "KHALANGA" —
  // the HQ-town name shared by many far/mid-west districts. The weak
  // place-name tiers are now rejected when hub and branch districts disagree.
  const FARWEST: Branch[] = [
    { name: "DHANGADHI", district: "Kailali", covered_areas: "ATTARIYA, GODAWARI" },
    { name: "MAHENDRANAGAR", district: "Kanchanpur", covered_areas: "BHIMDATT, DAIJI" },
    { name: "AMARGADHI", district: "Dadeldhura", covered_areas: "KHALANGA, JOGBUDHA, PARSHURAM" },
  ];

  it("Khalanga - Darchula => no match (covered_areas hit is in a different district)", () => {
    const dest = { name: "Khalanga - Darchula", district: "Darchula" as string | null };
    expect(matchNcmBranch(dest as any, FARWEST as any)).toBeUndefined();
  });

  it("Khalanga - Darchula => matches a real DARCHULA branch when NCM has one (tier 1)", () => {
    const withDarchula: Branch[] = [
      ...FARWEST,
      { name: "GOKULESHWOR", district: "Darchula", covered_areas: "KHALANGA, MAHAKALI" },
    ];
    const dest = { name: "Khalanga - Darchula", district: "Darchula" as string | null };
    expect(matchNcmBranch(dest as any, withDarchula as any)?.name).toBe("GOKULESHWOR");
  });

  it("exact branch-name tier (2) is district-gated: Khalanga - Darchula vs a KHALANGA branch in Salyan => no match", () => {
    const dest = { name: "Khalanga - Darchula", district: "Darchula" as string | null };
    const branches: Branch[] = [{ name: "KHALANGA", district: "Salyan", covered_areas: "SHARADA, KALIMATI" }];
    expect(matchNcmBranch(dest as any, branches as any)).toBeUndefined();
  });

  it("name-token tier (3b) is district-gated: multi-word place, token hits a branch in another district => no match", () => {
    const dest = { name: "Amargadhi Chowk - Darchula", district: "Darchula" as string | null };
    // placeName "AMARGADHI CHOWK" -> token "AMARGADHI" equals the branch name,
    // but that branch is in Dadeldhura, not Darchula.
    expect(matchNcmBranch(dest as any, FARWEST as any)).toBeUndefined();
  });

  it("covered_areas tier still fires when hub and branch districts agree", () => {
    const dest = { name: "Jhiljhile - Jhapa", district: "Jhapa" as string | null };
    // multi-branch Jhapa so tier 1 is ambiguous and the covered_areas tier is what resolves it
    const m = matchNcmBranch(dest as any, BRANCHES_JHAPA_MULTI as any);
    expect(m?.name).toBe("DAMAK");
  });

});
