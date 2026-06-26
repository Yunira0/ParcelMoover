import Redis from "ioredis";
import { AppError } from "../utils/AppError";


const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    db: parseInt(process.env.REDIS_DB || "0"),
    // Fail commands immediately rather than queuing retries when Redis is down
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 5000,
    // Exponential backoff up to 30 s, then give up reconnecting after 10 attempts
    retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 30_000);
    },
});

redis.on("connect", () => {
    console.log("[Redis] Connected successfully");
});

let _redisErrorLogged = false;
redis.on("error", (error) => {
    if (!_redisErrorLogged) {
        console.error("[Redis] Connection error (further errors suppressed):", error.message);
        _redisErrorLogged = true;
    }
});
redis.on("connect", () => { _redisErrorLogged = false; });


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