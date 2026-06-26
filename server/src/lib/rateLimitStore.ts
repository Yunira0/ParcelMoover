import { RedisStore } from "rate-limit-redis";
import { MemoryStore, Store } from "express-rate-limit";
import redis from "./redis";

/**
 * Returns a Redis-backed rate-limit store in production (required when running
 * multiple instances/PM2 workers so all share one counter), or an in-memory
 * store in development so Redis is not required locally.
 */
export function createRedisRateLimitStore(prefix: string): Store {
  if (process.env.NODE_ENV !== "production") {
    return new MemoryStore();
  }
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    sendCommand: (...args: string[]) => (redis as any).call(...args) as Promise<any>,
  });
}
