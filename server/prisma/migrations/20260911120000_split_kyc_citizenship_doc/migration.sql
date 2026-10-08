-- KYC applications now require both sides of the citizenship document.
-- Rename the single citizenship_doc column to citizenship_doc_front and add
-- citizenship_doc_back alongside it.
ALTER TABLE "vendor_kyc_applications"
  RENAME COLUMN "citizenship_doc" TO "citizenship_doc_front";

ALTER TABLE "vendor_kyc_applications"
  ADD COLUMN "citizenship_doc_back" TEXT;

-- Vendors created from an approved KYC application carry the back side too;
-- citizenship_doc keeps holding the front side for the existing admin-created
-- vendor/rider/admin registration flow, which is unaffected by this change.
ALTER TABLE "vendors"
  ADD COLUMN "citizenship_doc_back" TEXT;
