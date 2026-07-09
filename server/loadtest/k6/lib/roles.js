// Realistic-skew role distribution for simulated users: mostly vendors and
// riders (the actual day-to-day platform users), a modest slice of sales,
// and few admin/super_admin - mirroring that real orgs have far fewer
// internal staff than external vendor/rider accounts. Must sum to 100 and
// match (or stay under) the proportions the seed script's account counts
// were sized for - see server/loadtest/README.md.
export const ROLE_WEIGHTS = [
  { role: "vendor", weight: 70 },
  { role: "rider", weight: 15 },
  { role: "sales", weight: 8 },
  { role: "admin", weight: 6 },
  { role: "super_admin", weight: 1 },
];

// Deterministic role assignment per VU so the same VU always behaves as the
// same simulated user for the life of the test run.
export function roleForVU(vu) {
  const bucket = vu % 100;
  let acc = 0;
  for (const { role, weight } of ROLE_WEIGHTS) {
    acc += weight;
    if (bucket < acc) return role;
  }
  return ROLE_WEIGHTS[0].role;
}
