import Redis from "ioredis";
import { AppError } from "../utils/AppError";


const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    db: parseInt(process.env.REDIS_DB || "0"),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    lazyConnect: false, // Changed: Connect immediately
    connectTimeout: 5000,
    // commandTimeout not set — ioredis v5 treats 0 as a 0ms timeout (fires immediately)
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

redis.on("error", (error) => {
    console.error("[Redis] Connection error: ", error.message);
});

redis.on("reconnecting", () => {
    console.log("[Redis] Attempting to reconnect...");
});

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