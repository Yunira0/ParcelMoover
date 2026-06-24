-- AlterTable
-- parent_remark_id already exists in this database (added outside tracked
-- migrations); this migration only brings the schema.prisma model in sync.
-- Guarded with IF NOT EXISTS so it stays safe to deploy against a fresh DB too.
ALTER TABLE "parcel_remarks" ADD COLUMN IF NOT EXISTS "parent_remark_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parcel_remarks_parent_remark_id_fkey'
  ) THEN
    ALTER TABLE "parcel_remarks"
      ADD CONSTRAINT "parcel_remarks_parent_remark_id_fkey"
      FOREIGN KEY ("parent_remark_id") REFERENCES "parcel_remarks"("id") ON DELETE CASCADE;
  END IF;
END $$;
