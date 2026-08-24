-- 2005 was named "COD Held for Vendors", which only reads correctly from one
-- side of the account. A rider's remittance credits it with their own name on
-- the line - "COD Held for Vendors — Sunita Devi" - which reads as though the
-- money is being held for a vendor named Sunita Devi, not that she is the
-- rider who brought it in.
--
-- The account is a shared pool: every rider's remittance adds to it, every
-- vendor's payout draws down from it. "COD in Transit" reads correctly with
-- either kind of name on the line, and needs no accounting vocabulary to
-- understand.
UPDATE "ledger_accounts"
SET "name" = 'COD in Transit',
    "description" = 'COD taken in from riders but not yet passed on to vendors. Credited when a rider settles their collections to the office, debited when a vendor statement hands that money on. The balance is the float the office is sitting on: cash in our hands that is not ours. Deliberately not a control account - a rider remits one pooled sum that no single vendor can be named against.'
WHERE "code" = '2005';

-- 2000's own description named the account by its old text.
UPDATE "ledger_accounts"
SET "description" = 'Direct position with each vendor, outside the COD cycle: credited with payments they send the office. A credit balance is money we owe them; a debit balance is money they owe us. Day-to-day COD and delivery charges do not pass through here - they are recognised on the statement that settles them, against COD in Transit.'
WHERE "code" = '2000';
