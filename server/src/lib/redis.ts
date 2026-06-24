import Redis from "ioredis";
import { AppError } from "../utils/AppError";


const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    db: parseInt(process.env.REDIS_DB || "0"),
    maxRetriesPerRequest: 10,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 5000,
});

redis.on("connect", () => {
    console.log("[Redis] Connected successfully");
});

redis.on("error", (error) => {
    console.error("[Redis] Connection error: ", error.message);
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