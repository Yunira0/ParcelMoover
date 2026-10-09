-- One row per person per Nepal calendar day with at least one logged-in
-- request. Written by services/analytics/track.ts; read by pm-stats for
-- daily / weekly / monthly active users and "online now" (last_seen_at).
-- app_platform / app_version are filled once the rider app reports them.
CREATE TABLE "public"."user_daily_activity" (
    "day" DATE NOT NULL,
    "user_id" UUID NOT NULL,
    "user_group" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "app_platform" TEXT,
    "app_version" TEXT,
    CONSTRAINT "user_daily_activity_pkey" PRIMARY KEY ("day", "user_id")
);

CREATE INDEX "idx_user_daily_activity_last_seen" ON "public"."user_daily_activity" ("last_seen_at" DESC);

ALTER TABLE "public"."user_daily_activity"
    ADD CONSTRAINT "user_daily_activity_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
