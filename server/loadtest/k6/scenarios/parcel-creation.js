// Sustained parcel-intake load test against POST /api/orders/bulk.
//
// Usage:
//   k6 run -e PARCELS_PER_MIN=3000 -e DURATION=5m scenarios/parcel-creation.js
//
// Order-write endpoints are rate-limited per vendor actor (bulk: 5
// batches/min x 100 orders = 500 parcels/min/vendor - see order.routes.ts),
// so throughput here is capped by (seeded vendor count) x 500/min. Seed
// vendors first: npx ts-node prisma/seed-load-test-users.ts
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { BASE_URL } from "../config.js";
import { authHeaders } from "../lib/auth.js";
import { tokenFor, pools } from "../lib/pool.js";
import { uuidv4 } from "../lib/uuid.js";

const PARCELS_PER_MIN = Number(__ENV.PARCELS_PER_MIN) || 3000;
const BATCH_SIZE = Math.min(Number(__ENV.BATCH_SIZE) || 50, 100);
const DURATION = __ENV.DURATION || "5m";
const VENDOR_COUNT = pools.vendor.length;

const parcelsCreated = new Counter("parcels_created");
const rateLimited = new Counter("rate_limited_requests");

const ratePerMin = Math.max(1, Math.ceil(PARCELS_PER_MIN / BATCH_SIZE));
// Headroom above VENDOR_COUNT so a slow vendor doesn't stall the whole batch queue.
const vuBudget = Math.min(VENDOR_COUNT * 3, Number(__ENV.VU_BUDGET) || 300);

export const options = {
  scenarios: {
    parcel_creation: {
      executor: "constant-arrival-rate",
      rate: ratePerMin,
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: Math.min(vuBudget, ratePerMin),
      maxVUs: vuBudget,
    },
  },
  thresholds: {
    "http_req_duration{name:bulk_create}": ["p(95)<2000"],
    checks: ["rate>0.90"],
  },
};

export function setup() {
  console.log(
    `Target: ${PARCELS_PER_MIN} parcels/min via ${ratePerMin} batches/min of ${BATCH_SIZE} ` +
      `(bulk ceiling with ${VENDOR_COUNT} seeded vendors: ${VENDOR_COUNT * 500}/min)`,
  );
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

export default function () {
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
