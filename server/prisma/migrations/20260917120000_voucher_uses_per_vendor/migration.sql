-- A standalone voucher shares one code across every vendor, so how many times a
-- single vendor may spend it has to be a setting. Campaign codes are unique and
-- handed out one per vendor, so they stay at the default of one.
ALTER TABLE vouchers ADD COLUMN uses_per_vendor integer NOT NULL DEFAULT 1
  CHECK (uses_per_vendor > 0 AND uses_per_vendor <= 100);

-- One claim per (voucher, vendor) was the old per-vendor cap. The cap is now
-- uses_per_vendor, counted in the service inside the same locked transaction,
-- so a vendor holds one claim row per use.
ALTER TABLE voucher_claims DROP CONSTRAINT voucher_claims_voucher_id_vendor_id_key;
CREATE INDEX voucher_claims_voucher_id_vendor_id_idx ON voucher_claims(voucher_id, vendor_id);
