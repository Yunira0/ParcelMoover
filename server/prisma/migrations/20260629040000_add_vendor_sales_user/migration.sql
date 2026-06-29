-- Link a vendor to the sales user who owns the account, so sales accounts can be
-- scoped to only their own clients' data. Nullable; ON DELETE SET NULL so removing
-- a sales user leaves their vendors intact (just unassigned).
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "sales_user_id" UUID;

DO $$ BEGIN
  ALTER TABLE "vendors"
    ADD CONSTRAINT "vendors_sales_user_id_fkey"
    FOREIGN KEY ("sales_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_vendors_sales_user_id" ON "vendors"("sales_user_id");
