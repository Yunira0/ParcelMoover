#!/usr/bin/env tsx
/**
 * Quick local check of the fixed matchNcmBranch against the live demo NCM branches.
 * No DB needed — hits https://demo.nepalcanmove.com/api/v2/branches directly.
 *
 * Usage:
 *   tsx scripts/ncm-match-demo.ts
 *   NCM_BASE_URL=https://demo.nepalcanmove.com NCM_API_TOKEN=0c593... tsx scripts/ncm-match-demo.ts
 */
import "dotenv/config";

const BASE = process.env.NCM_BASE_URL || "https://demo.nepalcanmove.com";
const TOKEN = process.env.NCM_API_TOKEN || "0c593255a1805c938fd006ab01db5465fa680d8c";

type Raw = { name: string; district_name?: string; district?: string; province_name?: string; province?: string; areas_covered?: string | null; covered_areas?: string | null };
type Branch = { name: string; district?: string; covered_areas?: string | null };

function mapBranch(raw: Raw): Branch {
  const r: any = raw;
  return { name: raw.name, district: raw.district_name ?? raw.district ?? r.districtName, covered_areas: raw.areas_covered ?? raw.covered_areas ?? r.areasCovered };
}

function ncmMatchPlaceName(name: string): string {
  const i = name.indexOf(" - ");
  return (i === -1 ? name : name.slice(0, i)).trim();
}

function matchNcmBranch(
  destination: { name: string; district: string | null; ncm_branch?: string | null } | null | undefined,
  branches: Branch[],
): Branch | undefined {
  if (!destination) return undefined;
  const override = destination.ncm_branch?.trim().toUpperCase();
  if (override) {
    const byOverride = branches.find((b) => b.name.trim().toUpperCase() === override);
    if (byOverride) return byOverride;
    return undefined;
  }
  const normalizeDistrict = (s: string) => s.trim().toUpperCase().replace(/\s+DISTRICT\s*$/, "").replace(/\s+/g, " ").trim();
  const districtRaw = destination.district?.trim();
  const district = districtRaw ? normalizeDistrict(districtRaw) : "";
  if (district) {
    const byDistrict = branches.filter((b) => {
      const bd = b.district?.trim();
      return bd ? normalizeDistrict(bd) === district : false;
    });
    if (byDistrict.length === 1) return byDistrict[0];
  }
  const placeName = ncmMatchPlaceName(destination.name).trim().toUpperCase();
  if (!placeName) return undefined;
  const byPlaceExact = branches.find((b) => b.name.trim().toUpperCase() === placeName);
  if (byPlaceExact) return byPlaceExact;
  for (const branch of branches) {
    if (!branch.covered_areas) continue;
    const tokens = branch.covered_areas.split(/[,;/]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (tokens.includes(placeName)) return branch;
  }
  const placeTokens = placeName.split(/[\s\-_/]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const byToken = branches.find((b) => placeTokens.includes(b.name.trim().toUpperCase()));
  if (byToken) return byToken;
  return undefined;
}

async function main() {
  const url = new URL("/api/v2/branches", BASE);
  console.log(`Fetching NCM branches from ${url} ...`);
  const res = await fetch(url, { headers: { Authorization: `Token ${TOKEN}` } });
  if (!res.ok) {
    console.error(`Failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const raw = (await res.json()) as Raw[];
  const branches = raw.map(mapBranch);
  console.log(`\nLive branches (${branches.length}):`);
  for (const b of branches) {
    console.log(`  - ${b.name.padEnd(12)} district=${(b.district ?? "").padEnd(15)} areas=${(b.covered_areas ?? "").slice(0, 80)}`);
  }

  const cases: Array<{ name: string; district: string | null; ncm_branch?: string | null; expect?: string | null; note: string }> = [
    { name: "Jhiljhile", district: "Jhapa", note: "Village in Jhapa — demo has single Jhapa branch DAMAK, so district-single should win (not HILE/BAHUNDANGI)" , expect: "DAMAK"},
    { name: "Jhiljhile - Jhapa", district: "Jhapa", note: "Dash suffix stripping", expect: "DAMAK" },
    { name: "Jhiljhile", district: null, note: "No district — must not pick HILE via substring; covered_areas empty in demo so should be null (needs district or override)", expect: null },
    { name: "Hile", district: "Dhankuta", note: "Exact HILE — but HILE not in demo branches, so null", expect: null },
    { name: "Pokhara Branch", district: null, note: "Token word-boundary: Pokhara Branch => POKHARA", expect: "POKHARA" },
    { name: "Tinkune", district: "Kathmandu", note: "Exact TINKUNE", expect: "TINKUNE" },
    { name: "Jhiljhile", district: "Jhapa", ncm_branch: "DAMAK", note: "Explicit override pins to DAMAK", expect: "DAMAK" },
    { name: "Jhiljhile", district: "Jhapa", ncm_branch: "NONEXISTENT", note: "Bad override => null (don't fall through to wrong branch)", expect: null },
  ];

  // Add a synthetic multi-branch Jhapa test using the live list augmented with fake branches
  const fakeMulti: Branch[] = [
    { name: "DAMAK", district: "Jhapa", covered_areas: "JHILJHILE, BIRTAMODE" },
    { name: "BIRTAMODE", district: "Jhapa" },
    { name: "BAHUNDANGI", district: "Jhapa" },
  ];
  console.log(`\n--- Synthetic multi-Jhapa test (prod-like: 3 branches share Jhapa) ---`);
  for (const c of cases.slice(0, 2)) {
    const m = matchNcmBranch(c as any, fakeMulti);
    console.log(`${c.name} district=${c.district} -> ${m?.name ?? "NO MATCH"} (expected ${c.expect}) ${m?.name === c.expect ? "✅" : "❌"}  // ${c.note}`);
  }
  const ambiguous = matchNcmBranch({ name: "SomeUnknownVillage", district: "Jhapa" }, fakeMulti);
  console.log(`SomeUnknownVillage Jhapa -> ${ambiguous?.name ?? "NO MATCH"} (expected null, ambiguous) ${ambiguous ? "❌" : "✅"}`);

  console.log(`\n--- Live demo branches matching ---`);
  for (const c of cases) {
    const m = matchNcmBranch(c as any, branches);
    const ok = (m?.name ?? null) === c.expect ? "✅" : "❌";
    console.log(`${ok} ${c.name.padEnd(20)} district=${String(c.district).padEnd(10)} ncm_branch=${String(c.ncm_branch ?? "").padEnd(12)} -> ${m?.name ?? "NO MATCH"} (expected ${c.expect ?? "NO MATCH"}) // ${c.note}`);
  }

  console.log("\nDone. If Jhiljhile->DAMAK on demo ✅, the HILE/BAHUNDANGI substring+district-first bugs are fixed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
