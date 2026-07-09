import { SharedArray } from "k6/data";

// Tokens are pre-minted by `npx ts-node prisma/seed-load-test-users.ts`
// (server/loadtest/k6/pool.json) rather than logged in here - POST
// /auth/login is rate-limited at 500/15min PER IP (shared by this whole
// test run), so logging in thousands of VUs individually would either fail
// or take well over an hour. See server/loadtest/README.md.
//
// SharedArray's constructor callback runs once for the whole test (not
// once per VU) and the result is shared read-only across all VUs, so
// building one array per role here is cheap even at tens of thousands of VUs.
const ROLES = ["vendor", "rider", "sales", "admin", "super_admin"];

const raw = new SharedArray("loadtest-pool-raw", function () {
  let data;
  try {
    data = JSON.parse(open("../pool.json"));
  } catch (e) {
    throw new Error(
      "server/loadtest/k6/pool.json not found or unreadable. Run: " +
        "npx ts-node prisma/seed-load-test-users.ts (from server/)",
    );
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("pool.json is empty - run the seed script first.");
  }
  return data;
});

export const pools = {};
for (const role of ROLES) {
  pools[role] = new SharedArray(`loadtest-pool-${role}`, function () {
    return raw.filter((u) => u.role === role).map((u) => u.token);
  });
}

export function tokenFor(role, index) {
  const bucket = pools[role];
  if (!bucket || bucket.length === 0) {
    throw new Error(`No seeded accounts for role "${role}" - check LOADTEST_${role.toUpperCase()}_COUNT and reseed.`);
  }
  return bucket[index % bucket.length];
}
