import { RedisStore } from "rate-limit-redis";
import { MemoryStore, Store } from "express-rate-limit";
import type { Options } from "express-rate-limit";
import redis from "./redis";

// Wraps a store that lazily initializes once Redis is ready, falling back
// to MemoryStore if Redis is unavailable. This avoids the race where
// createRedisRateLimitStore is called at module-load time before Redis has
// connected — the old code created a RedisStore immediately, which then
// timed out on every command. If Redis fails after being selected, the wrapper
// downgrades that limiter to per-process memory limiting instead of disabling
// rate limiting for the request.
function createLazyRedisStore(prefix: string): Store {
  let redisStore: RedisStore | null = null;
  let memoryStore: MemoryStore | null = null;
  let options: Parameters<NonNullable<Store["init"]>>[0] | null = null;
  let fallbackWarned = false;
  let redisRetryAfter = 0;

  const getMemoryStore = () => {
    if (!memoryStore) {
      memoryStore = new MemoryStore();
      if (options) memoryStore.init(options);
    }
    return memoryStore;
  };

  const downgradeToMemory = (operation: string, error: unknown) => {
    redisStore = null;
    redisRetryAfter = Date.now() + 5_000;
    if (!fallbackWarned) {
      console.error(
        `[RateLimitStore] Redis ${operation} failed for prefix '${prefix}', using in-memory fallback:`,
        error instanceof Error ? error.message : error,
      );
      fallbackWarned = true;
    }
    return getMemoryStore();
  };

  // Swap from memory → redis the moment Redis becomes available.
  const tryUpgrade = () => {
    if (redisStore || redis.status !== "ready" || Date.now() < redisRetryAfter) return;
    try {
      redisStore = new RedisStore({
        prefix: `ratelimit:${prefix}:`,
        sendCommand: async (...args: string[]) => {
          return await (redis as any).call(...args);
        },
      });
      if (options) (redisStore as Store).init?.(options);
      memoryStore = null;
      fallbackWarned = false;
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
    init(initOptions: Options) {
      options = initOptions;
      if (memoryStore) memoryStore.init(initOptions);
      if (redisStore) (redisStore as Store).init?.(initOptions);
    },
    async increment(key: string) {
      tryUpgrade();
      if (redisStore) {
        try {
          return await redisStore.increment(key);
        } catch (error) {
          return downgradeToMemory("increment", error).increment(key);
        }
      }
      return getMemoryStore().increment(key);
    },
    async decrement(key: string) {
      tryUpgrade();
      if (redisStore) {
        try {
          return await redisStore.decrement(key);
        } catch (error) {
          return downgradeToMemory("decrement", error).decrement(key);
        }
      }
      return getMemoryStore().decrement(key);
    },
    async resetKey(key: string) {
      tryUpgrade();
      if (redisStore) {
        try {
          return await redisStore.resetKey(key);
        } catch (error) {
          return downgradeToMemory("resetKey", error).resetKey(key);
        }
      }
      return getMemoryStore().resetKey(key);
    },
  } as unknown as Store;
}

export function createRedisRateLimitStore(prefix: string) {
  return createLazyRedisStore(prefix);
}
