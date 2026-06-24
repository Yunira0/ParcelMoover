import { RedisStore } from "rate-limit-redis";
import redis from "./redis";

/**
 * express-rate-limit defaults to an in-memory store, which only counts hits
 * seen by the single Node process holding it. Behind multiple instances/PM2
 * workers that makes the limit effectively N times looser than configured.
 * Backing it with Redis gives one shared counter across all instances.
 */
export function createRedisRateLimitStore(prefix: string) {
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    sendCommand: (...args: string[]) => (redis as any).call(...args) as Promise<any>,
  });
}
