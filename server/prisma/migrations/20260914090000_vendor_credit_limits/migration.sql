-- Vendor-wise credit limits (positive NPR), replacing the negative-balance
-- block thresholds as the order-creation block driver. The warn threshold is
-- untouched: vendors are still warned first, blocked later.
--
-- Fresh installs and the schema default use NPR 50,000. That loosens the
-- previous effective block (-3,000) — vendors blocked between the two get
-- relief, nobody new gets blocked. Adjust it under Billing & Credit Control
-- if that is not what this office wants.
ALTER TABLE billing_settings ADD COLUMN default_credit_limit numeric(12,2) NOT NULL DEFAULT 50000
  CHECK (default_credit_limit > 0);
ALTER TABLE vendors ADD COLUMN credit_limit numeric(12,2) NOT NULL DEFAULT 50000
  CHECK (credit_limit > 0);

-- Vendors with an explicit block override keep its magnitude as their limit;
-- everyone else takes the new system default (the assignment new vendors get).
UPDATE vendors SET credit_limit = -billing_block_threshold
  WHERE billing_block_threshold IS NOT NULL AND -billing_block_threshold > 0;

-- Superseded: the block decision now reads credit_limit (block at
-- balance <= -credit_limit). The warn override stays.
ALTER TABLE vendors DROP COLUMN billing_block_threshold;
ALTER TABLE billing_settings DROP COLUMN block_threshold;
