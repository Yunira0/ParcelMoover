-- Vendor notices are now a banner-image-only format (no title/message text
-- shown to vendors) - drop the now-unused text/type columns and make the
-- image mandatory. The one existing row is disposable test data with no
-- image, so it's removed rather than backfilled.
DELETE FROM "vendor_notices" WHERE "image_url" IS NULL;

ALTER TABLE "vendor_notices" DROP COLUMN IF EXISTS "message";
ALTER TABLE "vendor_notices" DROP COLUMN IF EXISTS "type";
ALTER TABLE "vendor_notices" ALTER COLUMN "image_url" SET NOT NULL;

-- Referential integrity that was missing from the original migration.
ALTER TABLE "vendor_notices"
  ADD CONSTRAINT "vendor_notices_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON UPDATE NO ACTION;

ALTER TABLE "vendor_notice_targets"
  ADD CONSTRAINT "vendor_notice_targets_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "vendor_notice_dismissals"
  ADD CONSTRAINT "vendor_notice_dismissals_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "idx_vendor_notices_is_active" ON "vendor_notices"("is_active");
