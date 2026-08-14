-- 2000 was "Vendor Control". It is just "Vendor" now: the name is the only
-- thing that changes, so nothing already posted to it means anything different.
UPDATE ledger_accounts
   SET name = 'Vendor', updated_at = now()
 WHERE code = '2000';

-- 2010 Direct Customer Payable is retired. Every parcel and COD collection now
-- has to name a vendor -- the posting service refuses one that does not -- so
-- there is no longer anything that books here.
--
-- Deleted outright only when nothing ever referenced it. If entries were posted,
-- the row stays and is deactivated instead: deleting it would strand those
-- journal lines and take the balance sheet out with them. A leftover row shows
-- up in the ledger with its historical balance, which is the honest outcome.
DO $$
DECLARE
  v_account_id uuid;
  v_referenced boolean;
BEGIN
  SELECT id INTO v_account_id FROM ledger_accounts WHERE code = '2010';
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    EXISTS (SELECT 1 FROM journal_lines WHERE account_id = v_account_id)
    OR EXISTS (SELECT 1 FROM expenses WHERE account_id = v_account_id OR paid_from_id = v_account_id)
    OR EXISTS (SELECT 1 FROM payment_methods WHERE ledger_account_id = v_account_id)
    OR EXISTS (SELECT 1 FROM ledger_accounts WHERE parent_id = v_account_id)
  INTO v_referenced;

  IF v_referenced THEN
    UPDATE ledger_accounts
       SET is_active = false,
           description = 'Retired. Held the vendor side of parcels booked without a vendor; those are no longer accepted. Kept because entries were posted here.',
           updated_at = now()
     WHERE id = v_account_id;
  ELSE
    DELETE FROM ledger_accounts WHERE id = v_account_id;
  END IF;
END $$;
