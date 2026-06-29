-- Per-vendor rate overrides so different vendors on the same rate model can be
-- charged differently. NULL falls back to the global pricing_settings default.
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "flat_inside_valley" DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "flat_outside_valley" DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "zone_major_cities" DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "zone_urban_areas" DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "zone_remote_areas" DECIMAL(12,2);
