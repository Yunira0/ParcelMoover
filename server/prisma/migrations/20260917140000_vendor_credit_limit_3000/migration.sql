-- Tighten vendor credit: warn at Rs. 2,000 owed, block at Rs. 3,000.
--
-- The NPR 50,000 the credit-limit migration shipped was a placeholder that
-- loosened the old -3,000 block. This restores that block line as an explicit
-- per-vendor limit, and moves every vendor still sitting on the placeholder
-- onto it. Vendors given a hand-set limit keep it.
ALTER TABLE billing_settings ALTER COLUMN default_credit_limit SET DEFAULT 3000;
ALTER TABLE vendors ALTER COLUMN credit_limit SET DEFAULT 3000;

UPDATE billing_settings SET default_credit_limit = 3000 WHERE default_credit_limit = 50000;
UPDATE vendors SET credit_limit = 3000 WHERE credit_limit = 50000;

-- The warn line is a single office-wide setting and is already -2,000; state
-- it anyway so a fresh install and an existing one agree.
UPDATE billing_settings SET warn_threshold = -2000 WHERE warn_threshold <> -2000;
