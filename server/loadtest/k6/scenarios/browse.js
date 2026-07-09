// Simulates many concurrent logged-in users across ALL five roles
// (vendor/rider/sales/admin/super_admin) browsing the dashboard and order
// list - the read-heavy traffic pattern of the actual site.
//
// Usage (ramp toward 30k in stages - see README for why):
//   k6 run -e MAX_VUS=3000  -e RAMP_TIME=1m -e HOLD_TIME=3m scenarios/browse.js
//   k6 run -e MAX_VUS=10000 -e RAMP_TIME=2m -e HOLD_TIME=3m scenarios/browse.js
//   k6 run -e MAX_VUS=30000 -e RAMP_TIME=3m -e HOLD_TIME=5m scenarios/browse.js
//
// Requires accounts seeded first: npx ts-node prisma/seed-load-test-users.ts
//
// NOTE ON SCALE: tens of thousands of concurrent connections from a single
// machine to localhost usually hit OS limits (ephemeral ports especially on
// macOS: net.inet.ip.portrange) before the app does. Ramp in stages and
// watch for connection errors in http_req_failed - see README for tuning.
//
// Read endpoints are rate-limited per actor (120 req/min - orderReadLimiter
// in order.routes.ts). VU count per role is intentionally backed by enough
// seeded accounts (see lib/roles.js weights + seed script counts) to stay
// under that at a realistic browsing pace; if you change MAX_VUS or the
// role weights, re-check the math in the README or you'll just re-measure
// the rate limiter again.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { BASE_URL } from "../config.js";
import { authHeaders } from "../lib/auth.js";
import { tokenFor } from "../lib/pool.js";
import { roleForVU } from "../lib/roles.js";

const MAX_VUS = Number(__ENV.MAX_VUS) || 3000;
const RAMP_TIME = __ENV.RAMP_TIME || "1m";
const HOLD_TIME = __ENV.HOLD_TIME || "3m";

const rateLimited = new Counter("rate_limited_requests");
const requestsByRole = new Counter("requests_by_role");

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP_TIME, target: MAX_VUS },
        { duration: HOLD_TIME, target: MAX_VUS },
        { duration: RAMP_TIME, target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    "http_req_duration{name:dashboard_summary}": ["p(95)<3000"],
    "http_req_duration{name:list_orders}": ["p(95)<2000"],
  },
};

function get(url, name, role, headers) {
  const res = http.get(url, { headers, tags: { name, role } });
  requestsByRole.add(1, { role });
  if (res.status === 429) {
    rateLimited.add(1, { role });
  } else {
    check(res, { [`${name} ok`]: (r) => r.status === 200 });
  }
  return res;
}

export default function () {
  const role = roleForVU(__VU);
  const token = tokenFor(role, __VU);
  const headers = authHeaders(token);

  get(`${BASE_URL}/api/orders/dashboard-summary`, "dashboard_summary", role, headers);
  sleep(Math.random() * 2 + 3);

  // No filters/pagination on purpose: that's the only shape of this call the
  // app actually caches (see isDefaultUnfilteredQuery in order.service.ts),
  // matching how OrderManagement's default "All" tab calls it in production.
  get(`${BASE_URL}/api/orders`, "list_orders", role, headers);
  sleep(Math.random() * 2 + 3);

  // Admin-only view of parcels currently out with riders - occasional, not
  // every cycle, since it's a secondary screen even for admins.
  if ((role === "admin" || role === "super_admin") && Math.random() < 0.3) {
    get(`${BASE_URL}/api/orders/run-sheet`, "run_sheet", role, headers);
    sleep(Math.random() * 2 + 2);
  }
}
