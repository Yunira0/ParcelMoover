import Redis from "ioredis";
import { AppError } from "../utils/AppError";


const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    db: parseInt(process.env.REDIS_DB || "0"),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    // Must connect eagerly (not lazily): index.ts's startup sequence waits on
    // this client's "ready"/"error" events before registering any routes, so
    // the connection attempt needs to start as soon as this module loads.
    lazyConnect: false,
    connectTimeout: 5000,
    // Bounds how long a single command (e.g. the login rate-limiter's INCR)
    // can sit queued waiting for a connection before failing. Without this,
    // maxRetriesPerRequest: null + enableOfflineQueue: true means a command
    // issued while Redis is mid-reconnect just queues forever - which,
    // combined with axios having no request timeout on the client, turns
    // into a login/request that silently hangs forever with no error.
    // NOTE: must be a positive value - ioredis v5 treats 0 as a 0ms timeout
    // (fires immediately), so leaving this unset or at 0 is NOT "no timeout".
    commandTimeout: 3000,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
});

redis.on("connect", () => {
    console.log("[Redis] Connected successfully");
});

redis.on("ready", () => {
    console.log("[Redis] Ready to accept commands");
});

let _redisErrorLogged = false;
redis.on("error", (error) => {
    if (!_redisErrorLogged) {
        console.error("[Redis] Connection error (further errors suppressed):", error.message);
        _redisErrorLogged = true;
    }
});
redis.on("connect", () => { _redisErrorLogged = false; });

// Same suppression as the error handler above - without Redis running (e.g.
// local dev), retryStrategy fires this every ~2s forever and would otherwise
// flood the console.
let _redisReconnectingLogged = false;
redis.on("reconnecting", () => {
    if (!_redisReconnectingLogged) {
        console.log("[Redis] Attempting to reconnect... (further attempts logged silently)");
        _redisReconnectingLogged = true;
    }
});
redis.on("connect", () => { _redisReconnectingLogged = false; });

export default redis;


// Grageful shutdown
process.on("SIGTERM", async () => {
    console.log("[REDIS] Closing connection....");
    await redis.quit();
})

export async function withRedis<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new AppError(503, "Service temporarily unavailable. Please retry.");
  }
}

// SCAN iterates incrementally instead of blocking the event loop like KEYS does,
// which matters once the keyspace holding this prefix grows past a handful of entries.
export async function scanAndDelete(pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    if (keys.length) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}