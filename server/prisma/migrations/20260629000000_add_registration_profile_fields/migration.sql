-- Profile, document and bank fields collected by the admin / rider / vendor
-- registration forms. All nullable; idempotent so it is safe to re-run.

-- admins
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "citizenship_no" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "pan" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "father_name" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mother_name" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "grandfather_name" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "permanent_address" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "current_address" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "experience" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "citizenship_doc" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "pan_doc" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "experience_letter_doc" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "bank_name" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "bank_account_no" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "bank_account_holder" TEXT;

-- riders
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "rider_location" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "citizenship_no" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "licence_no" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "vehicle_no" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "salary_commission" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "pan" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "citizenship_doc" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "pan_vat_doc" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "licence_doc" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "bluebook_doc" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "bank_name" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "bank_account_no" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "bank_account_holder" TEXT;

-- vendors
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "pickup_landmark" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "billing_business_name" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "registration_no" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "pan_vat_no" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "citizenship_doc" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "pan_vat_doc" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "business_cert_doc" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "bank_name" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "bank_account_no" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "bank_account_holder" TEXT;
