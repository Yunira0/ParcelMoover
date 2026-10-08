-- The nine classes people actually file under, and the two the balance sheet
-- needs to close.
--
-- The previous shape asked for a type and then a sub-type, which is two
-- questions for one decision: nobody picks "expense" and then wonders which
-- kind - they know it is rent before they know rent is an expense. So the
-- sub-type is now the only thing anyone chooses, and `type` is derived from it.
-- That is why `type` stays: every report in the app groups by it, and a
-- balance sheet is assets/liabilities/equity whatever the chart calls its
-- sections.
--
-- The `other_*` catch-alls are gone. A catch-all is where accounts go to stop
-- being classified, and each of them had a real home: an unclassified asset is
-- a current asset until someone says otherwise, and "other income" is what
-- indirect income means.
--
-- Capital and reserves are not in the nine, and are kept anyway: equity is not
-- optional on a balance sheet, and 3000 Opening Balance Equity and 3900
-- Retained Earnings already exist. Dropping them would leave two live accounts
-- holding a value the enum no longer has.

CREATE TYPE "ledger_account_sub_type_new" AS ENUM (
  'fixed_asset',
  'intangible_asset',
  'current_asset',
  'long_term_liability',
  'current_liability',
  'capital',
  'reserves',
  'direct_income',
  'indirect_income',
  'direct_expense',
  'indirect_expense'
);

-- Each retired value goes to the one that meant the same thing, so no account
-- comes out of this unclassified.
ALTER TABLE "ledger_accounts"
  ALTER COLUMN "sub_type" TYPE "ledger_account_sub_type_new"
  USING (
    CASE "sub_type"::text
      WHEN 'operating_revenue' THEN 'direct_income'
      WHEN 'other_income'      THEN 'indirect_income'
      WHEN 'other_asset'       THEN 'current_asset'
      WHEN 'other_liability'   THEN 'current_liability'
      WHEN 'other_expense'     THEN 'indirect_expense'
      ELSE "sub_type"::text
    END
  )::"ledger_account_sub_type_new";

DROP TYPE "ledger_account_sub_type";
ALTER TYPE "ledger_account_sub_type_new" RENAME TO "ledger_account_sub_type";

COMMENT ON COLUMN "ledger_accounts"."sub_type" IS
  'What the account is, and the only classification anyone picks. `type` is derived from it by masters.service and is what the reports group by. Null only on rows that predate the column.';
