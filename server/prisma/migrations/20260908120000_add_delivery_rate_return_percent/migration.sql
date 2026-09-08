-- Route-based return pricing. A return parcel on a configured (origin ->
-- destination) route is charged this percent of the route's delivery charge.
-- branch_return_percent is the parallel value for service_type = branch_delivery
-- and falls back to return_percent when null (mirrors branch_base_charge).
ALTER TABLE "delivery_rates"
  ADD COLUMN "return_percent" DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "branch_return_percent" DECIMAL(5, 2);
