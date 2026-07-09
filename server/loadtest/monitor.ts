// Samples server-side resource usage every 3s during a load test run, so
// client-side k6 latency numbers can be correlated against what the DB/Redis/
// Node process were actually doing at that moment, rather than inferred.
// Usage: npx ts-node loadtest/monitor.ts <output.csv> <node_pid> [durationSeconds]
//
// IMPORTANT: point <output.csv> OUTSIDE this server/ directory. nodemon
// watches the whole project tree, so writing samples into server/loadtest/
// every 3s makes it think source changed and restart the app mid-test -
// which shows up in k6 as a total outage (0 bytes sent/received) but is a
// test-harness bug, not a finding. Write to /tmp or a scratch dir instead.
import "dotenv/config";
import * as fs from "fs";
import { execSync } from "child_process";
import { pool } from "../src/lib/prisma";
import redis from "../src/lib/redis";

const OUT = process.argv[2];
const NODE_PID = process.argv[3] ? Number(process.argv[3]) : undefined;
const DURATION = process.argv[4] ? Number(process.argv[4]) : Infinity;

if (!OUT) {
  console.error("Usage: monitor.ts <output.csv> <node_pid> [durationSeconds]");
  process.exit(1);
}

fs.writeFileSync(
  OUT,
  "timestamp,pg_active,pg_idle_in_txn,pg_total,redis_reachable,redis_used_memory_mb,redis_connected_clients,redis_ops_per_sec,node_rss_mb,node_cpu_pct\n",
);

function nodeStats(pid?: number): [string, string] {
  if (!pid) return ["0", "0"];
  try {
    const out = execSync(`ps -o rss=,%cpu= -p ${pid}`).toString().trim().split(/\s+/);
    return [(Number(out[0]) / 1024).toFixed(1), out[1] ?? "0"];
  } catch {
    return ["0", "0"];
  }
}

async function pgStats() {
  try {
    const r = await pool.query(
      `SELECT
         count(*) FILTER (WHERE state = 'active') AS active,
         count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_txn,
         count(*) AS total
       FROM pg_stat_activity WHERE datname = current_database()`,
    );
    return [r.rows[0].active, r.rows[0].idle_in_txn, r.rows[0].total];
  } catch {
    return ["err", "err", "err"];
  }
}

async function redisStats() {
  try {
    const [mem, clients, stats] = await Promise.all([
      redis.info("memory"),
      redis.info("clients"),
      redis.info("stats"),
    ]);
    const usedMem = Number(/used_memory:(\d+)/.exec(mem)?.[1] ?? 0) / 1048576;
    const connClients = /connected_clients:(\d+)/.exec(clients)?.[1] ?? "0";
    const opsPerSec = /instantaneous_ops_per_sec:(\d+)/.exec(stats)?.[1] ?? "0";
    return ["1", usedMem.toFixed(1), connClients, opsPerSec];
  } catch {
    return ["0", "0", "0", "0"];
  }
}

let elapsed = 0;
const interval = setInterval(async () => {
  const ts = Math.floor(Date.now() / 1000);
  const [pgActive, pgIdleTxn, pgTotal] = await pgStats();
  const [redisUp, redisMem, redisClients, redisOps] = await redisStats();
  const [rssMb, cpuPct] = nodeStats(NODE_PID);
  fs.appendFileSync(
    OUT,
    `${ts},${pgActive},${pgIdleTxn},${pgTotal},${redisUp},${redisMem},${redisClients},${redisOps},${rssMb},${cpuPct}\n`,
  );
  elapsed += 3;
  if (elapsed >= DURATION) {
    clearInterval(interval);
    await pool.end();
    redis.disconnect();
    process.exit(0);
  }
}, 3000);
 