-- Recategorize service_type from the 4-way (dtd/btd/btb/dtb) to home_delivery /
-- branch_delivery, keyed on the destination side (…-to-door = home, …-to-branch
-- = branch). Existing rows are migrated by that rule.
CREATE TYPE "service_type_new" AS ENUM ('home_delivery', 'branch_delivery');

ALTER TABLE "parcels" ALTER COLUMN "service_type" DROP DEFAULT;
ALTER TABLE "parcels" ALTER COLUMN "service_type" TYPE "service_type_new"
  USING (
    CASE
      WHEN "service_type"::text IN ('dtd', 'btd') THEN 'home_delivery'
      ELSE 'branch_delivery'
    END
  )::"service_type_new";
DROP TYPE "service_type";
ALTER TYPE "service_type_new" RENAME TO "service_type";
ALTER TABLE "parcels" ALTER COLUMN "service_type" SET DEFAULT 'home_delivery';

-- Parallel branch-delivery rate set across the pricing model (null = fall back).
ALTER TABLE "pricing_settings"
  ADD COLUMN IF NOT EXISTS "branch_zone_major_cities" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_zone_urban_areas" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_zone_remote_areas" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_zone_inside_valley" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_flat_inside_valley" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_flat_outside_valley" DECIMAL(12,2);

ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "branch_flat_inside_valley" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_flat_outside_valley" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_zone_major_cities" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_zone_urban_areas" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_zone_remote_areas" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "branch_zone_inside_valley" DECIMAL(12,2);

ALTER TABLE "delivery_rates" ADD COLUMN IF NOT EXISTS "branch_base_charge" DECIMAL(12,2);
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "branch_per_destination_rate" DECIMAL(12,2);
