-- Restructure vendor_kyc_applications to match required registration fields.
-- Drops old columns, adds new grouped columns.

ALTER TABLE "vendor_kyc_applications"
  -- Business Details
  ADD COLUMN "online_business_name" TEXT,
  ADD COLUMN "pickup_location"      TEXT,
  ADD COLUMN "pickup_landmark"      TEXT,
  ADD COLUMN "business_contact"     TEXT,

  -- Owner / Contact Person (owner_name + email already exist, rename email→owner_email)
  ADD COLUMN "owner_email"          TEXT,
  ADD COLUMN "owner_contact"        TEXT,

  -- Billing Details
  ADD COLUMN "billing_business_name" TEXT,
  ADD COLUMN "registered_address"    TEXT,
  ADD COLUMN "registration_no"       TEXT,

  -- Documents
  ADD COLUMN "citizenship_doc"       TEXT,
  ADD COLUMN "pan_vat_doc"           TEXT,
  ADD COLUMN "business_cert_doc"     TEXT,

  -- Bank Details
  ADD COLUMN "bank_name"             TEXT,
  ADD COLUMN "bank_account_no"       TEXT,
  ADD COLUMN "bank_account_holder"   TEXT;

-- Migrate existing data into new columns before dropping old ones
UPDATE "vendor_kyc_applications" SET
  "online_business_name" = "business_name",
  "pickup_location"      = "address",
  "business_contact"     = "phone",
  "owner_email"          = "email",
  "owner_contact"        = "phone",
  "registered_address"   = "address";

-- Make new required columns NOT NULL after backfill
ALTER TABLE "vendor_kyc_applications"
  ALTER COLUMN "online_business_name" SET NOT NULL,
  ALTER COLUMN "pickup_location"      SET NOT NULL,
  ALTER COLUMN "business_contact"     SET NOT NULL,
  ALTER COLUMN "owner_email"          SET NOT NULL,
  ALTER COLUMN "owner_contact"        SET NOT NULL;

-- Drop old columns
ALTER TABLE "vendor_kyc_applications"
  DROP COLUMN "business_name",
  DROP COLUMN "email",
  DROP COLUMN "phone",
  DROP COLUMN "address",
  DROP COLUMN "city",
  DROP COLUMN "business_type",
  DROP COLUMN "id_type",
  DROP COLUMN "id_number",
  DROP COLUMN "website",
  DROP COLUMN "monthly_shipment_estimate",
  DROP COLUMN "description";
