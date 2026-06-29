import { RedisStore } from "rate-limit-redis";
import { MemoryStore } from "express-rate-limit";
import redis from "./redis";

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
