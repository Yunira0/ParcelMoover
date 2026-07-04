import { RedisStore } from "rate-limit-redis";
import { MemoryStore } from "express-rate-limit";
import redis from "./redis";

// index.ts's startup sequence already waits for Redis to be ready before
// registering any routes (and therefore before this is ever called), so the
// readiness check below only guards a transient Redis blip after startup,
// not the normal cold-start case.
export function createRedisRateLimitStore(prefix: string) {
  if (redis.status !== "ready") {
    console.warn(
      `[RateLimitStore] Redis not ready for prefix '${prefix}', using in-memory store (single-instance only)`,
    );
    return new MemoryStore();
  }

  try {
    return new RedisStore({
      prefix: `ratelimit:${prefix}:`,
      sendCommand: async (...args: string[]) => {
        return await (redis as any).call(...args);
      },
    });
  } catch (error) {
    console.error(`[RateLimitStore] Failed to create Redis store for '${prefix}', falling back to memory`, error);
    return new MemoryStore();
  }
}
