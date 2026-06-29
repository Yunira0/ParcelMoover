-- Vendor's chosen delivery rate model: per_destination | zone | flat.
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rate_type" TEXT NOT NULL DEFAULT 'flat';

-- Per-destination pricing classification + flat rate stored on the destination.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "zone" TEXT;                       -- major_cities | urban_areas | remote_areas
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "valley" TEXT;                     -- inside | outside
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "per_destination_rate" DECIMAL(12,2);

-- Global single-row config for zone-based and flat (valley) rates.
CREATE TABLE IF NOT EXISTS "pricing_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "zone_major_cities" DECIMAL(12,2),
  "zone_urban_areas" DECIMAL(12,2),
  "zone_remote_areas" DECIMAL(12,2),
  "flat_inside_valley" DECIMAL(12,2),
  "flat_outside_valley" DECIMAL(12,2),
  "free_weight_kg" DECIMAL(10,3) NOT NULL DEFAULT 2,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("id")
);
