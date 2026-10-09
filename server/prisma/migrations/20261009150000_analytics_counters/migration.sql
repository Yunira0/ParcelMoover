-- A lasting copy of pm-stats' request counts. The server counts requests in
-- Redis, which on our host does not save to disk; services/analytics/persist.ts
-- copies the hourly and per-day hashes here every 5 minutes so a Redis restart
-- does not erase history. One row per Redis hash field:
--   bucket  the Redis key, e.g. pm:traffic:h:2026100908 or pm:apikeys:d:2026-10-09
--   field   the hash field, e.g. req|dashboard or <api key id>|n
-- Rows not updated for 90 days are deleted by the same job.
CREATE TABLE "public"."analytics_counters" (
    "bucket" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "count" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "analytics_counters_pkey" PRIMARY KEY ("bucket", "field")
);

CREATE INDEX "idx_analytics_counters_updated_at" ON "public"."analytics_counters" ("updated_at");
