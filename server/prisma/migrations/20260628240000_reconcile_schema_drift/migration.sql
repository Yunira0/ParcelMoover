-- Reconcile migration history with schema.prisma.
-- These objects exist in schema.prisma (and are used by the app/seed) but were
-- never added by a migration -- they had been applied via `db push` in some
-- environments. All statements are idempotent so this is safe to run against
-- databases that already have them.

-- parcels: missing columns referenced by the seed and order service.
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "package_type" TEXT;
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "delivery_instruction" TEXT;

-- delivery_rates: entire table missing from migration history.
CREATE TABLE IF NOT EXISTS "delivery_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "origin_location_id" UUID NOT NULL,
    "destination_location_id" UUID NOT NULL,
    "base_charge" DECIMAL(12,2) NOT NULL,
    "extra_weight_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "free_weight_kg" DECIMAL(10,3) NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_rates_origin_location_id_destination_location_id_key"
    ON "delivery_rates"("origin_location_id", "destination_location_id");

DO $$ BEGIN
    ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_origin_location_id_fkey"
        FOREIGN KEY ("origin_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_destination_location_id_fkey"
        FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
