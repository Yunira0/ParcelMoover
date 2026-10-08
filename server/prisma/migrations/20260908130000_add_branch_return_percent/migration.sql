-- Branch-delivery return rate: a return parcel dropped at a branch is charged
-- this percent of the branch delivery charge. Parallel to branch_flat_* -
-- each value falls back to its home return_*_percent counterpart when null.
ALTER TABLE "vendors"
  ADD COLUMN "branch_return_inside_valley_percent" DECIMAL(5, 2),
  ADD COLUMN "branch_return_outside_valley_percent" DECIMAL(5, 2);

ALTER TABLE "pricing_settings"
  ADD COLUMN "branch_return_inside_valley_percent" DECIMAL(5, 2),
  ADD COLUMN "branch_return_outside_valley_percent" DECIMAL(5, 2);
