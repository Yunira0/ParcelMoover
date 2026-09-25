-- Branch credit control, on its own scale: warn at Rs. 2,000 owed, block at
-- Rs. 10,000. The -50,000 / -75,000 pair these replace was set when branch
-- balances were expected to run far larger than they do.
--
-- Branches keep the explicit warn/block threshold pair rather than the
-- positive credit_limit vendors use, so the values stay negative here. The
-- block line is the branch's credit limit, and is editable per branch via the
-- branch_billing_block_threshold override.
ALTER TABLE billing_settings ALTER COLUMN branch_warn_threshold SET DEFAULT -2000;
ALTER TABLE billing_settings ALTER COLUMN branch_block_threshold SET DEFAULT -10000;

UPDATE billing_settings
   SET branch_warn_threshold  = -2000
 WHERE branch_warn_threshold IN (-50000, -3000);
UPDATE billing_settings
   SET branch_block_threshold = -10000
 WHERE branch_block_threshold IN (-75000, -3000);
