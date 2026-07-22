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
    startNcmReconciliation();
    startKycDocumentPurge();
    startWebhookDelivery();
  });
}

// NCM never retries a failed webhook, so in-flight NCM parcels are swept
// periodically for statuses a lost webhook missed. The Redis NX lock keeps
// one process per interval doing the sweep when multiple instances run
// against the same NCM account.
const NCM_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
const NCM_RECONCILE_LOCK_KEY = "ncm:reconcile-lock";

function startNcmReconciliation() {
  if (!process.env.NCM_BASE_URL || !process.env.NCM_API_TOKEN) return;

  setInterval(async () => {
    try {
      const acquired = await redis.set(
        NCM_RECONCILE_LOCK_KEY,
        "1",
        "EX",
        Math.floor(NCM_RECONCILE_INTERVAL_MS / 1000) - 60,
        "NX",
      );
      if (!acquired) return;
    } catch {
      // Redis down — run anyway; reconciliation is idempotent.
    }
    try {
      const { reconcileNcmStatuses, flushPendingNcmComments, syncNcmCommentsToParcels } = await import(
        "./services/ncm.service"
      );
      const result = await reconcileNcmStatuses();
      if (result.checked > 0) {
        console.log(`[NCM] reconciliation: checked ${result.checked}, applied ${result.applied}`);
      }
      // Spaced out, not back-to-back: firing all three sweep steps at once is
      // itself enough to trip NCM's demo-host per-minute throttle.
      await new Promise((r) => setTimeout(r, 1000));
      const comments = await flushPendingNcmComments();
      if (comments.attempted > 0) {
        console.log(`[NCM] pending comments: attempted ${comments.attempted}, delivered ${comments.delivered}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
      const inbound = await syncNcmCommentsToParcels();
      if (inbound.ingested > 0) {
        console.log(`[NCM] inbound comments: checked ${inbound.checked}, ingested ${inbound.ingested}`);
      }
    } catch (error) {
      console.error("[NCM] reconciliation sweep failed:", error);
    }
  }, NCM_RECONCILE_INTERVAL_MS).unref();
}

// Rejected KYC applicants' documents (citizenship/PAN/business-cert scans)
// are purged 30 days after rejection - see purgeExpiredRejectedKycDocuments.
// Same Redis NX lock pattern as NCM reconciliation so only one instance runs
// the sweep when multiple app processes share the same database.
const KYC_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const KYC_PURGE_LOCK_KEY = "kyc:document-purge-lock";

function startKycDocumentPurge() {
  setInterval(async () => {
    try {
      const acquired = await redis.set(
        KYC_PURGE_LOCK_KEY,
        "1",
        "EX",
        Math.floor(KYC_PURGE_INTERVAL_MS / 1000) - 60,
        "NX",
      );
      if (!acquired) return;
    } catch {
      // Redis down — run anyway; the purge is idempotent.
    }
    try {
      const { purgeExpiredRejectedKycDocuments } = await import("./services/kyc.service");
      const result = await purgeExpiredRejectedKycDocuments();
      if (result.purged > 0) {
        console.log(`[KYC] document purge: checked ${result.checked}, purged ${result.purged}`);
      }
    } catch (error) {
      console.error("[KYC] document purge sweep failed:", error);
    }
  }, KYC_PURGE_INTERVAL_MS).unref();
}

// Drains pending webhook_deliveries (the transactional outbox order.service.ts
// writes into on every status change) and retries failed ones on backoff.
// Runs far more often than the sweeps above since vendors expect webhooks to
// feel close to real-time - short enough that, unlike those, we explicitly
// release the lock each tick instead of letting a long TTL expire it.
const WEBHOOK_DELIVERY_INTERVAL_MS = 15 * 1000;
const WEBHOOK_DELIVERY_LOCK_KEY = "webhook:delivery-lock";

function startWebhookDelivery() {
  setInterval(async () => {
    let locked = false;
    try {
      locked = Boolean(
        await redis.set(WEBHOOK_DELIVERY_LOCK_KEY, "1", "PX", WEBHOOK_DELIVERY_INTERVAL_MS - 1000, "NX"),
      );
      if (!locked) return;
    } catch {
      // Redis down — run anyway; delivery is idempotent (rows only move
      // forward: pending -> succeeded/failed).
      locked = false;
    }
    try {
      const { runDeliverySweep } = await import("./services/webhookDispatch.service");
      const result = await runDeliverySweep();
      if (result.attempted > 0) {
        console.log(`[Webhook] delivery sweep: attempted ${result.attempted}`);
      }
    } catch (error) {
      console.error("[Webhook] delivery sweep failed:", error);
    } finally {
      if (locked) {
        try {
          await redis.del(WEBHOOK_DELIVERY_LOCK_KEY);
        } catch {
          // Lock will still expire on its own via PX above.
        }
      }
    }
  }, WEBHOOK_DELIVERY_INTERVAL_MS).unref();
}

startServer().catch((error) => {
  console.error("[Startup] Failed to start server:", error);
  process.exit(1);
});
