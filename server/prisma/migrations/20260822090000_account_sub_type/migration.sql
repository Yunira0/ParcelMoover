-- Sub-type: the classification between a type and an account.
--
-- "Asset" is too coarse to be a heading anyone files under. Every chart people
-- actually keep puts a fixed asset in a different section from a bank balance,
-- and reads a balance sheet in that order. The tree could express it - a
-- "Current Assets" group with children - but a group is a free-text account
-- anybody can name, so two people file the same thing under two spellings and
-- the balance sheet has two sections that mean one thing. A closed enum cannot
-- drift, and it is what the reports can safely group by.
--
-- Nullable, because accounts predating this column are real and must stay
-- readable. The backfill below gives each one the sub-type its type implies, so
-- nothing is left unclassified in practice.

CREATE TYPE "ledger_account_sub_type" AS ENUM (
  'current_asset',
  'fixed_asset',
  'other_asset',
  'current_liability',
  'long_term_liability',
  'other_liability',
  'capital',
  'reserves',
  'operating_revenue',
  'other_income',
  'direct_expense',
  'indirect_expense',
  'other_expense'
);

ALTER TABLE "ledger_accounts" ADD COLUMN "sub_type" "ledger_account_sub_type";

COMMENT ON COLUMN "ledger_accounts"."sub_type" IS
  'Classification within `type`, e.g. a fixed vs a current asset. Constrained to the sub-types its type allows by masters.service; null only on rows that predate the column.';

-- Existing accounts, classified by what they are. The seeded chart is entirely
-- cash, COD floats, delivery income and running costs, so the default each type
-- implies is the right answer for all of them but retained earnings, which is a
-- reserve rather than capital put in.
UPDATE "ledger_accounts"
SET "sub_type" = (
  CASE "type"
    WHEN 'asset'     THEN 'current_asset'
    WHEN 'liability' THEN 'current_liability'
    WHEN 'equity'    THEN 'capital'
    WHEN 'revenue'   THEN 'operating_revenue'
    WHEN 'expense'   THEN 'indirect_expense'
  END
)::"ledger_account_sub_type";

UPDATE "ledger_accounts" SET "sub_type" = 'reserves' WHERE "code" = '3900';

-- Reports group by type then sub-type then code; without this every balance
-- sheet pays for a sort of the whole chart.
CREATE INDEX "idx_ledger_accounts_type_sub_type" ON "ledger_accounts" ("type", "sub_type", "code");
