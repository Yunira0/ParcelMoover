-- Per-status SLA thresholds (in hours). One row per configurable key:
-- pickup/delivery/transit parcel statuses plus the 'remarks' and 'return' keys.
-- sla_hours NULL means the SLA is disabled for that key.
CREATE TABLE IF NOT EXISTS "sla_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status_key" TEXT NOT NULL,
    "sla_hours" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "sla_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sla_settings_status_key_key" ON "sla_settings"("status_key");

-- Seed the configurable keys with sensible defaults.
INSERT INTO "sla_settings" ("status_key", "sla_hours") VALUES
    ('pickup_ordered', 24),
    ('rider_assigned', 24),
    ('picked_up', 24),
    ('arrived', 24),
    ('ready_to_deliver', 24),
    ('sent_for_delivery', 24),
    ('oov', 48),
    ('dispatched', 48),
    ('arrived_at_branch', 48),
    ('remarks', 24),
    ('return', 72)
ON CONFLICT ("status_key") DO NOTHING;
