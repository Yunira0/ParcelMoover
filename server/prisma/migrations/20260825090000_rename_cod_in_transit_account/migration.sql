-- "COD in Transit" was read as if the money were still moving. It is not - it
-- is sitting in the office's own cash/bank, already collected from the rider,
-- waiting on the statement that pays it out to the vendor it belongs to. "COD
-- to Pay to Vendor" says who it is owed to, which is the fact that matters.
UPDATE "ledger_accounts"
SET "name" = 'COD to Pay to Vendor',
    "description" = 'COD taken in from riders but not yet passed on to vendors. Credited when a rider settles their collections to the office, debited when a vendor statement hands that money on. The balance is the float the office is sitting on: cash in our hands that is not ours. Deliberately not a control account - a rider remits one pooled sum that no single vendor can be named against.'
WHERE "code" = '2005';

-- 2000's own description named the account by its old text.
UPDATE "ledger_accounts"
SET "description" = 'Direct position with each vendor, outside the COD cycle: credited with payments they send the office. A credit balance is money we owe them; a debit balance is money they owe us. Day-to-day COD and delivery charges do not pass through here - they are recognised on the statement that settles them, against COD to Pay to Vendor.'
WHERE "code" = '2000';
