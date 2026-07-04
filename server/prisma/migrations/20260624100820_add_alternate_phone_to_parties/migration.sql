-- Guarded with IF NOT EXISTS / EXCEPTION WHEN duplicate_object throughout:
-- these same objects (package_type, delivery_instruction, delivery_rates) are
-- also created by the later 20260628240000_reconcile_schema_drift migration,
-- which was written assuming they were only ever applied via `db push`. On a
-- database where that migration already ran, this one running unguarded
-- would fail with "already exists" errors.

-- AlterTable
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "delivery_instruction" TEXT;
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "package_type" TEXT;

-- AlterTable
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "alternate_phone" TEXT;

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_rates_origin_location_id_destination_location_id_key" ON "delivery_rates"("origin_location_id", "destination_location_id");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_origin_location_id_fkey" FOREIGN KEY ("origin_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
