-- Link vendor_staff to users for login capability.
-- user_id is nullable so existing staff rows aren't broken.
ALTER TABLE "vendor_staff" ADD COLUMN IF NOT EXISTS "user_id" UUID UNIQUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_staff_user_id_fkey'
  ) THEN
    ALTER TABLE "vendor_staff"
      ADD CONSTRAINT "vendor_staff_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Seed the vendor_staff role so JWT tokens can carry it.
INSERT INTO "roles" (id, name, code, created_at)
  VALUES (gen_random_uuid(), 'Vendor Staff', 'vendor_staff', now())
  ON CONFLICT (code) DO NOTHING;
