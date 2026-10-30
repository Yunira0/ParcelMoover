import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";

// A real Postgres (PGlite) behind prisma, and an in-memory stand-in for Redis.
const h = vi.hoisted(() => ({
  db: null as unknown as import("@electric-sql/pglite").PGlite,
  redis: {} as Record<string, Record<string, string>>,
  redisDown: false,
}));
vi.mock("../../../lib/prisma", () => ({
  default: {
    $executeRaw: async (q: Prisma.Sql) => (await h.db.query(q.text, q.values)).affectedRows,
    $queryRaw: async (q: Prisma.Sql) => (await h.db.query(q.text, q.values)).rows,
  },
  pool: {},
}));
const fakeRedis = vi.hoisted(() => ({
  pipeline() {
    const keys: string[] = [];
    const p = {
      hgetall: (key: string) => { keys.push(key); return p; },
      exec: async () => {
        // Reads the shared state through globalThis: vi.hoisted blocks run before `h` exists.
        const state = (globalThis as unknown as { __pmStatsRedis: { down: boolean; data: Record<string, Record<string, string>> } }).__pmStatsRedis;
        if (state.down) throw new Error("Connection is closed.");
        return keys.map((key) => [null, state.data[key] ?? {}]);
      },
    };
    return p;
  },
}));
vi.mock("../../../lib/redis", () => ({ default: fakeRedis }));

import { buildDeleteOldQuery, bucketsToCopy, keepField, persistCounters } from "../persist";
import { readBuckets, readTrafficSlots } from "../queries/counters";
import { summarize } from "../queries/api";

const now = new Date("2026-10-09T08:47:00Z");
const thisHour = "pm:traffic:h:2026100908";
const lastHour = "pm:traffic:h:2026100907";
const today = "pm:apikeys:d:2026-10-09";

async function saved(): Promise<Record<string, string>> {
  const { rows } = await h.db.query<{ bucket: string; field: string; count: string }>(
    "SELECT bucket, field, count::text AS count FROM analytics_counters ORDER BY bucket, field");
  return Object.fromEntries(rows.map((r) => [`${r.bucket} ${r.field}`, r.count]));
}

beforeAll(async () => {
  h.db = new PGlite();
  await h.db.exec(`
    CREATE TABLE analytics_counters (
      bucket text NOT NULL, field text NOT NULL, count bigint NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (bucket, field)
    );
  `);
}, 20_000);
afterAll(() => h.db.close());

beforeEach(async () => {
  await h.db.exec("DELETE FROM analytics_counters");
  h.redis = {};
  h.redisDown = false;
  (globalThis as unknown as { __pmStatsRedis: unknown }).__pmStatsRedis = {
    get down() { return h.redisDown; },
    get data() { return h.redis; },
  };
});

describe("saving request counts to Postgres", () => {
  it("copies the current and previous hour, today's and yesterday's API calls, and last calls", () => {
    expect(bucketsToCopy(now)).toEqual([
      thisHour, lastHour, today, "pm:apikeys:d:2026-10-08", "pm:apikeys:last",
    ]);
  });

  it("keeps totals, errors and speed by app, and calls per request type, but not speed per request type", () => {
    expect(["req|rider", "5xx|rider", "b3|rider", "r|GET /api/me|n", "r|GET /api/me|e"]
      .every((f) => keepField(thisHour, f))).toBe(true);
    expect(keepField(thisHour, "r|GET /api/me|b3")).toBe(false);
    expect(keepField(today, "key-1|s422")).toBe(true);
  });

  it("never lets a Redis restart shrink a saved count", async () => {
    h.redis[thisHour] = { "req|dashboard": "500", "r|GET /api/me|b2": "40", "r|GET /api/me|n": "40" };
    h.redis[today] = { "key-1|n": "30" };
    expect(await persistCounters(now)).toBe(3);
    expect(await saved()).toEqual({
      [`${thisHour} r|GET /api/me|n`]: "40",
      [`${thisHour} req|dashboard`]: "500",
      [`${today} key-1|n`]: "30",
    });

    // Redis restarted: this hour starts again from a small number.
    h.redis[thisHour] = { "req|dashboard": "12" };
    await persistCounters(now);
    expect((await saved())[`${thisHour} req|dashboard`]).toBe("500");

    // Later in the hour the fresh count passes the saved one.
    h.redis[thisHour] = { "req|dashboard": "620" };
    await persistCounters(now);
    expect((await saved())[`${thisHour} req|dashboard`]).toBe("620");
  });

  it("deletes copies not updated for 90 days", async () => {
    await h.db.exec(`INSERT INTO analytics_counters VALUES
      ('old', 'req|rider', 1, now() - interval '91 days'), ('new', 'req|rider', 1, now() - interval '89 days')`);
    const q = buildDeleteOldQuery();
    await h.db.query(q.text, q.values);
    expect(Object.keys(await saved())).toEqual(["new req|rider"]);
  });
});

describe("reading counts back after Redis lost them", () => {
  beforeEach(async () => {
    // Postgres has both hours; Redis only still has this hour.
    await h.db.exec(`INSERT INTO analytics_counters (bucket, field, count) VALUES
      ('${lastHour}', 'req|dashboard', 300), ('${lastHour}', 'req|rider', 100),
      ('${lastHour}', '5xx|dashboard', 6), ('${lastHour}', 'b2|dashboard', 300),
      ('${lastHour}', 'r|GET /api/me|n', 90), ('${thisHour}', 'req|dashboard', 999)`);
    h.redis[thisHour] = { "req|dashboard": "50", "b1|dashboard": "50" };
  });

  it("uses Redis where it still has the hour, Postgres where it does not", async () => {
    const { slots, extra } = await readTrafficSlots(fakeRedis as never, [lastHour, thisHour]);
    expect(slots).toEqual([
      { "req|dashboard": "300", "req|rider": "100" },
      { "req|dashboard": "50", "b1|dashboard": "50" },
    ]);
    expect(extra).toEqual({ "5xx|dashboard": "6", "b2|dashboard": "300", "r|GET /api/me|n": "90" });

    const summary = summarize([...slots, extra]);
    expect(summary.overall).toMatchObject({ requests: 450, errors: 6 });
    expect(summary.series.slice(0, 2)).toEqual([400, 50]);
  });

  it("still shows saved numbers when Redis is down", async () => {
    h.redisDown = true;
    const { slots, redisError } = await readTrafficSlots(fakeRedis as never, [lastHour, thisHour]);
    expect(redisError).toBe("Connection is closed.");
    expect(slots[1]).toEqual({ "req|dashboard": "999" });
  });

  it("fills Partner API days from Postgres when Redis lost them", async () => {
    await h.db.exec(`INSERT INTO analytics_counters (bucket, field, count) VALUES ('${today}', 'key-1|n', 30)`);
    const { hashes } = await readBuckets(fakeRedis as never, [today]);
    expect(hashes[0]).toEqual({ "key-1|n": "30" });
  });
});
