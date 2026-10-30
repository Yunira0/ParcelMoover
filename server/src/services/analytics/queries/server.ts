// Server health for `pm-stats api` and `live`. Run inside the app container,
// load and memory are the host's (containers share the host kernel) and disk
// is the volume Docker stores containers on.

import fs from "node:fs";
import os from "node:os";
import type Redis from "ioredis";
import prisma from "../../../lib/prisma";

export type ServerStats = {
  loadPct: number;
  memoryUsedPct: number;
  diskUsedPct: number | null;
  db: { inUse: number; max: number } | null;
  redis: { ok: boolean; usedMemory: string | null };
};

export async function getServerStats(redis: Redis): Promise<ServerStats> {
  const [db, redisStats] = await Promise.all([databaseConnections(), redisHealth(redis)]);
  return {
    loadPct: Math.round((os.loadavg()[0]! / Math.max(1, os.cpus().length)) * 100),
    memoryUsedPct: memoryUsedPct(),
    diskUsedPct: diskUsedPct(),
    db,
    redis: redisStats,
  };
}

// MemAvailable counts reclaimable cache as free, which os.freemem() does not.
function memoryUsedPct(): number {
  try {
    const info = fs.readFileSync("/proc/meminfo", "utf8");
    const read = (name: string) => Number(info.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1]);
    const total = read("MemTotal");
    const available = read("MemAvailable");
    if (total > 0 && available >= 0) return Math.round(((total - available) / total) * 100);
  } catch {
    // Not Linux (local development): fall back below.
  }
  return Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
}

// Same arithmetic as `df`: used / (used + available to non-root users).
function diskUsedPct(): number | null {
  try {
    const stats = fs.statfsSync("/");
    const used = stats.blocks - stats.bfree;
    return Math.round((used / (used + stats.bavail)) * 100);
  } catch {
    return null;
  }
}

async function databaseConnections(): Promise<ServerStats["db"]> {
  try {
    const [row] = await prisma.$queryRaw<{ in_use: number; max: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS in_use,
             current_setting('max_connections')::int AS max`;
    return row ? { inUse: row.in_use, max: row.max } : null;
  } catch {
    return null;
  }
}

async function redisHealth(redis: Redis): Promise<ServerStats["redis"]> {
  try {
    await redis.ping();
    const info = await redis.info("memory");
    return { ok: true, usedMemory: info.match(/^used_memory_human:(\S+)/m)?.[1] ?? null };
  } catch {
    return { ok: false, usedMemory: null };
  }
}
