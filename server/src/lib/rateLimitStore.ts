import { RedisStore } from "rate-limit-redis";
import { MemoryStore, Store } from "express-rate-limit";
import redis from "./redis";

// Wraps a store that lazily initializes once Redis is ready, falling back
// to MemoryStore if Redis is unavailable. This avoids the race where
// createRedisRateLimitStore is called at module-load time before Redis has
// connected — the old code created a RedisStore immediately, which then
// timed out on every command.
function createLazyRedisStore(prefix: string): Store {
  let redisStore: RedisStore | null = null;
  let memoryStore: MemoryStore | null = null;
  let warned = false;

  // Swap from memory → redis the moment Redis becomes available.
  const tryUpgrade = () => {
    if (redisStore || redis.status !== "ready") return;
    try {
      redisStore = new RedisStore({
        prefix: `ratelimit:${prefix}:`,
        sendCommand: async (...args: string[]) => {
          return await (redis as any).call(...args);
        },
      });
      memoryStore = null;
      console.log(`[RateLimitStore] Redis ready for prefix '${prefix}', switched to Redis store`);
    } catch (error) {
      console.error(`[RateLimitStore] Failed to create Redis store for '${prefix}'`, error);
    }
  };

  // Listen for Redis becoming ready so we upgrade as soon as possible.
  redis.once("ready", tryUpgrade);

  // If Redis is already ready (e.g. warm restart), upgrade immediately.
  tryUpgrade();

  return {
    async increment(key: string) {
      tryUpgrade();
      if (redisStore) return redisStore.increment(key);
      if (!memoryStore) memoryStore = new MemoryStore();
      return memoryStore.increment(key);
    },
    async decrement(key: string) {
      tryUpgrade();
      if (redisStore) return redisStore.decrement(key);
      if (!memoryStore) memoryStore = new MemoryStore();
      return memoryStore.decrement(key);
    },
    async resetKey(key: string) {
      tryUpgrade();
      if (redisStore) return (redisStore as any).resetKey?.(key);
      if (!memoryStore) memoryStore = new MemoryStore();
      return memoryStore.resetKey(key);
    },
  } as unknown as Store;
}

export function createRedisRateLimitStore(prefix: string) {
  return createLazyRedisStore(prefix);
}
