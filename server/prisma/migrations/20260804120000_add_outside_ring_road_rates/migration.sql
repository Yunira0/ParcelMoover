-- Add "outside ring road" as a third flat-rate pricing tier for inside-valley destinations
ALTER TABLE "locations" ADD COLUMN "ring_road" TEXT;

ALTER TABLE "pricing_settings" ADD COLUMN "flat_outside_ring_road" DECIMAL(12,2);
ALTER TABLE "pricing_settings" ADD COLUMN "branch_flat_outside_ring_road" DECIMAL(12,2);

ALTER TABLE "vendors" ADD COLUMN "flat_outside_ring_road" DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN "branch_flat_outside_ring_road" DECIMAL(12,2);
