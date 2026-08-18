-- The cash side of the chart is flat now: 1000 Cash in Hand for cash received,
-- and one account per payment method an admin adds. The family accounts money
-- used to fall into - 1020 Bank Accounts, 1030 Digital Wallets, 1090
-- Unclassified Funds - are gone from the chart, and posting refuses a method
-- with no account of its own rather than guessing at a family.

-- 1. Flatten. Method accounts (prabhu bank, kumari bank) were parented under
--    their family so the chart read as a tree; with the families going, they
--    stand on their own next to Cash in Hand.
UPDATE ledger_accounts
   SET parent_id = NULL, updated_at = now()
 WHERE parent_id IN (SELECT id FROM ledger_accounts WHERE code IN ('1020', '1030', '1090'));

-- 2. Retire the three family accounts.
--
--    Deleted outright only when nothing ever referenced one. Where entries were
--    posted, the row stays and is deactivated: the money is real and went
--    somewhere, and deleting the account would strand those lines and take the
--    balance sheet out with them. Those balances need reassigning to the method
--    that actually received them, which is a decision, not a migration.
DO $$
DECLARE
  v_code text;
  v_id uuid;
  v_referenced boolean;
BEGIN
  FOREACH v_code IN ARRAY ARRAY['1020', '1030', '1090'] LOOP
    SELECT id INTO v_id FROM ledger_accounts WHERE code = v_code;
    CONTINUE WHEN v_id IS NULL;

    SELECT
      EXISTS (SELECT 1 FROM journal_lines WHERE account_id = v_id)
      OR EXISTS (SELECT 1 FROM expenses WHERE account_id = v_id OR paid_from_id = v_id)
      OR EXISTS (SELECT 1 FROM ledger_accounts WHERE parent_id = v_id)
    INTO v_referenced;

    IF v_referenced THEN
      UPDATE ledger_accounts
         SET is_active = false, updated_at = now()
       WHERE id = v_id;
    ELSE
      -- Nothing was ever posted here, so a payment method still pointing at it
      -- has no history to lose by being unlinked. An active method gets a fresh
      -- account of its own on the next read; a disabled one is left alone.
      UPDATE payment_methods SET ledger_account_id = NULL WHERE ledger_account_id = v_id;
      DELETE FROM ledger_accounts WHERE id = v_id;
    END IF;
  END LOOP;
END $$;
