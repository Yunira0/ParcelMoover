-- KYC verification for existing vendors. Onboarding applications (vendor_id NULL)
-- keep creating a brand-new vendor on approval; verification applications link
-- to a living vendor and only record the KYC_APPROVE audit the voucher gate
-- reads. One pending verification per vendor at a time.
ALTER TABLE vendor_kyc_applications ADD COLUMN vendor_id uuid NULL REFERENCES vendors(id);
CREATE INDEX idx_kyc_vendor_id ON vendor_kyc_applications(vendor_id);
CREATE UNIQUE INDEX kyc_one_pending_per_vendor ON vendor_kyc_applications(vendor_id)
  WHERE vendor_id IS NOT NULL AND status = 'pending'::kyc_status;
