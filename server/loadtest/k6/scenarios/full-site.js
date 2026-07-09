// Combined load test: sustained parcel intake + many concurrent browsing
// users across all five roles, running at the same time - the realistic
// "site under load" picture. Prefer running parcel-creation.js and
// browse.js separately first so you can attribute a bottleneck to one
// traffic pattern; use this once you want the combined picture.
//
// Usage:
//   k6 run \
//     -e PARCELS_PER_MIN=3000 -e BATCH_SIZE=50 \
//     -e MAX_VUS=3000 -e RAMP_TIME=1m -e HOLD_TIME=3m \
//     scenarios/full-site.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { BASE_URL } from "../config.js";
import { authHeaders } from "../lib/auth.js";
import { tokenFor, pools } from "../lib/pool.js";
import { roleForVU } from "../lib/roles.js";
import { uuidv4 } from "../lib/uuid.js";

const PARCELS_PER_MIN = Number(__ENV.PARCELS_PER_MIN) || 3000;
const BATCH_SIZE = Math.min(Number(__ENV.BATCH_SIZE) || 50, 100);
const MAX_VUS = Number(__ENV.MAX_VUS) || 3000;
const RAMP_TIME = __ENV.RAMP_TIME || "1m";
const HOLD_TIME = __ENV.HOLD_TIME || "3m";

const VENDOR_COUNT = pools.vendor.length;
const ratePerMin = Math.max(1, Math.ceil(PARCELS_PER_MIN / BATCH_SIZE));
const creationVuBudget = Math.min(VENDOR_COUNT * 3, 300);

const parcelsCreated = new Counter("parcels_created");
const rateLimited = new Counter("rate_limited_requests");

export const options = {
  scenarios: {
    parcel_creation: {
      executor: "constant-arrival-rate",
      exec: "createParcels",
      rate: ratePerMin,
      timeUnit: "1m",
      duration: `${parseDurationMin(RAMP_TIME) * 2 + parseDurationMin(HOLD_TIME)}m`,
      preAllocatedVUs: Math.min(creationVuBudget, ratePerMin),
      maxVUs: creationVuBudget,
    },
    browse: {
      executor: "ramping-vus",
      exec: "browseSite",
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
    "http_req_duration{name:bulk_create}": ["p(95)<2000"],
    "http_req_duration{name:dashboard_summary}": ["p(95)<3000"],
    "http_req_duration{name:list_orders}": ["p(95)<2000"],
  },
};

// Rough duration parser for "1m"/"30s" style env-provided strings, just to
// size the arrival-rate scenario's duration to match the browse ramp.
function parseDurationMin(s) {
  const m = /^(\d+)m$/.exec(s);
  if (m) return Number(m[1]);
  const sec = /^(\d+)s$/.exec(s);
  if (sec) return Math.ceil(Number(sec[1]) / 60);
  return 1;
}

function randomOrder(seed) {
  const n = `${Date.now()}-${seed}-${__VU}-${__ITER}`;
  return {
    sender: { name: `Loadtest Sender ${n}`, phone: "+9779800000001" },
    receiver: { name: `Loadtest Receiver ${n}`, phone: "+9779800000002" },
    pieces: 1,
    weightKg: 1,
    codAmount: 0,
  };
}

export function createParcels() {
  const token = tokenFor("vendor", __VU);
  const orders = [];
  for (let i = 0; i < BATCH_SIZE; i++) orders.push(randomOrder(i));

  const res = http.post(
    `${BASE_URL}/api/orders/bulk`,
    JSON.stringify({ orders }),
    {
      headers: { ...authHeaders(token), "Idempotency-Key": uuidv4() },
      tags: { name: "bulk_create" },
    },
  );

  if (res.status === 429) {
    rateLimited.add(1);
  } else {
    check(res, { "bulk create succeeded (207)": (r) => r.status === 207 });
    const created = res.json("data.created");
    if (typeof created === "number") parcelsCreated.add(created);
  }
}

export function browseSite() {
  const role = roleForVU(__VU);
  const token = tokenFor(role, __VU);
  const headers = authHeaders(token);

  const dash = http.get(`${BASE_URL}/api/orders/dashboard-summary`, {
    headers,
    tags: { name: "dashboard_summary" },
  });
  if (dash.status === 429) rateLimited.add(1);
  else check(dash, { "dashboard ok": (r) => r.status === 200 });
  sleep(Math.random() * 2 + 3);

  // No filters/pagination on purpose - see browse.js for why.
  const list = http.get(`${BASE_URL}/api/orders`, {
    headers,
    tags: { name: "list_orders" },
  });
  if (list.status === 429) rateLimited.add(1);
  else check(list, { "list ok": (r) => r.status === 200 });
  sleep(Math.random() * 2 + 3);
}
