-- Give every payment method its own ledger account.
--
-- Until now the ledger routed money by pattern-matching the method's name:
-- anything containing "bank" landed in one Bank Accounts bucket, anything
-- matching a known wallet in another, and everything else in Unclassified
-- Funds. That works for three fixed methods and stops working the moment the
-- office banks with two different banks - "Prabhu Bank" and "Nabil Bank" would
-- pile into one balance that reconciles against neither statement, and a method
-- nobody thought to add to the pattern would silently land in Unclassified.
--
-- Instead, adding a payment method now creates the account that holds its money.
-- The three original accounts stay exactly where they are and keep their
-- history; they become the parents that the new per-method accounts hang under,
-- so "Cash & bank" still totals correctly while each method also reports its own
-- balance.

-- Codes for auto-created accounts. 1100+ deliberately sits above the hand-picked
-- 1000-1090 block, so a generated code can never collide with a seeded one.
CREATE SEQUENCE "payment_account_code_seq" AS BIGINT START WITH 1100 INCREMENT BY 1;

ALTER TABLE "payment_methods" ADD COLUMN "ledger_account_id" UUID;

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_ledger_account_id_fkey"
    FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- One account per method, not shared. Two methods pointing at one account would
-- reintroduce exactly the merged-balance problem this replaces.
CREATE UNIQUE INDEX "uq_payment_methods_ledger_account" ON "payment_methods"("ledger_account_id")
    WHERE "ledger_account_id" IS NOT NULL;
