import "dotenv/config";
import redis from "./lib/redis";

const port = process.env.PORT || 3000;

async function startServer() {
  // Wait for Redis to be fully ready before registering routes so that
  // rate-limit stores, SSE subscriptions, and cache clients all get a live
  // connection on first use instead of falling back to in-memory stores.
  if (redis.status !== "ready") {
    console.log("[Startup] Waiting for Redis...");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Redis did not become ready within 10 seconds"));
      }, 10_000);
      redis.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      redis.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // Dynamic import: server.ts registers all routes (and creates rate-limit
  // stores) here, after Redis is confirmed ready.
  const { default: app } = await import("./server");

  app.listen(port, () => {
    console.log(`[Startup] Server is running on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("[Startup] Failed to start server:", error);
  process.exit(1);
});
