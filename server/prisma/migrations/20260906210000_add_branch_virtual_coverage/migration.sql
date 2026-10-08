-- A branch's "covered areas" (locations.parent_id) re-parents a plain,
-- non-hub destination under it - the destination stops existing
-- independently for routing purposes. That mechanism can't be reused to
-- cover another BRANCH: re-parenting a hub would strip its own is_hub
-- status and break its independent routing, pricing and settlements.
--
-- Virtual coverage is the side-relationship this needs instead: branch A
-- lists branch B as also covered by it (for A's manifest destination
-- checks, settlement eligibility, branch orders/overview rollups), while B
-- keeps functioning exactly as its own branch everywhere else - nothing
-- about B's own row changes, and no parcel's destination_location_id is
-- ever touched. Purely additive and one-directional: A covering B does not
-- imply B covers A.
CREATE TABLE "branch_virtual_coverage" (
    "branch_id"         UUID NOT NULL,
    "covered_branch_id" UUID NOT NULL,
    "created_by"        UUID,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "branch_virtual_coverage_pkey" PRIMARY KEY ("branch_id", "covered_branch_id"),
    CONSTRAINT "branch_virtual_coverage_not_self" CHECK ("branch_id" <> "covered_branch_id")
);

CREATE INDEX "idx_branch_virtual_coverage_covered_branch"
    ON "branch_virtual_coverage"("covered_branch_id");

ALTER TABLE "branch_virtual_coverage" ADD CONSTRAINT "branch_virtual_coverage_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "branch_virtual_coverage" ADD CONSTRAINT "branch_virtual_coverage_covered_branch_id_fkey"
    FOREIGN KEY ("covered_branch_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "branch_virtual_coverage" ADD CONSTRAINT "branch_virtual_coverage_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
