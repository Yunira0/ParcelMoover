-- Return parcels carry no COD but still incur a delivery charge, billed as a
-- percent of the normal delivery rate and split by the destination's valley side
-- (e.g. 0% inside valley, 50% outside valley). The global defaults live on
-- pricing_settings; per-vendor overrides live on vendors (null = use the global).
ALTER TABLE "pricing_settings" ADD COLUMN IF NOT EXISTS "return_inside_valley_percent" DECIMAL(5,2);
ALTER TABLE "pricing_settings" ADD COLUMN IF NOT EXISTS "return_outside_valley_percent" DECIMAL(5,2);

ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "return_inside_valley_percent" DECIMAL(5,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "return_outside_valley_percent" DECIMAL(5,2);
