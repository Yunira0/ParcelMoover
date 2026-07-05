import "dotenv/config";
import redis from "./lib/redis";
import { verifyMailer } from "./lib/mailer";
import { generateTrackingId } from "./utils/trackingId";

const port = process.env.PORT || 3000;

async function startServer() {
  // Give Redis a few seconds to come up so rate-limit stores, SSE
  // subscriptions, and cache clients get a live connection on first use
  // instead of falling back to in-memory stores. But every one of those
  // call sites already degrades gracefully when Redis is unreachable
  // (rateLimitStore falls back to MemoryStore, cache reads/writes are
  // wrapped in try/catch elsewhere) - so a slow/missing Redis in local dev
  // must not crash the whole server. It'll keep retrying in the background
  // (see retryStrategy in lib/redis.ts) and callers pick it up once ready.
  if (redis.status !== "ready") {
    console.log("[Startup] Waiting for Redis...");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn("[Startup] Redis not ready after 10s - starting anyway with in-memory fallbacks.");
        resolve();
      }, 10_000);
      redis.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      redis.once("error", (err) => {
        clearTimeout(timeout);
        console.warn("[Startup] Redis error before ready - starting anyway with in-memory fallbacks:", err.message);
        resolve();
      });
    });
  }

  // Dynamic import: server.ts registers all routes (and creates rate-limit
  // stores) here, after Redis is confirmed ready (or given up on above).
  const { default: app } = await import("./server");

  app.listen(port, () => {
    console.log(`[Startup] Server is running on port ${port}`);
    console.log(generateTrackingId());
    verifyMailer();
  });
}

startServer().catch((error) => {
  console.error("[Startup] Failed to start server:", error);
  process.exit(1);
});
