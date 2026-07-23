-- Vendor staff can now record a contact phone number (optional), mirroring the
-- name/email already denormalized onto vendor_staff from users.
ALTER TABLE "vendor_staff" ADD COLUMN IF NOT EXISTS "phone" TEXT;
