-- CreateTable: vendor staff accounts with per-member permissions.
-- Guarded with IF NOT EXISTS so it's safe to run against the existing DB.
CREATE TABLE IF NOT EXISTS "vendor_staff" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "vendor_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "permissions" TEXT[] NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "vendor_staff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_vendor_staff_vendor_id" ON "vendor_staff" ("vendor_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_staff_vendor_id_fkey'
  ) THEN
    ALTER TABLE "vendor_staff"
      ADD CONSTRAINT "vendor_staff_vendor_id_fkey"
      FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
