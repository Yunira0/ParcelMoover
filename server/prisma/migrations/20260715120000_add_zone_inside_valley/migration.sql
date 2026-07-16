-- Zone-based charges gain an "Inside valley" zone alongside major cities /
-- urban areas / remote areas. Both the global defaults (pricing_settings) and
-- the per-vendor overrides (vendors) get the new column; null falls back to
-- the global default, matching the other zone columns.
ALTER TABLE "pricing_settings" ADD COLUMN IF NOT EXISTS "zone_inside_valley" DECIMAL(12,2);

ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "zone_inside_valley" DECIMAL(12,2);
