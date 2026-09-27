-- Fonepay as a payment method, with its ledger account.
--
-- Branch "Add money" deposits default to method "fonepay" (branch-billing
-- createBranchPayment), but no payment method by that name existed, so the
-- ledger had no account to receive them and every branch statement paid that
-- way was left unposted (see describeBranchSettlement / cashAccountForMethod).
--
-- The account is created here rather than left to payment-method.service's
-- lazy backfill, which only runs when someone opens the method list - a
-- deposit verified before then would still find no account.
--
-- Matched case-insensitively, like createPaymentMethod. A Fonepay row an admin
-- already added is kept as it is (active or not); it only gets an account if
-- it has none.
DO $$
DECLARE
  method_id  UUID;
  account_id UUID;
BEGIN
  SELECT "id", "ledger_account_id" INTO method_id, account_id
    FROM "payment_methods"
   WHERE lower("name") = 'fonepay'
   LIMIT 1;

  IF account_id IS NULL THEN
    INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_side", "sub_type", "description")
    VALUES (
      nextval('payment_account_code_seq')::text, 'Fonepay', 'asset', 'debit', 'current_asset',
      'Money received through Fonepay. Created automatically with the payment method.'
    )
    RETURNING "id" INTO account_id;
  END IF;

  IF method_id IS NULL THEN
    INSERT INTO "payment_methods" ("name", "sort_order", "ledger_account_id")
    VALUES ('Fonepay', (SELECT COALESCE(MAX("sort_order"), 0) + 1 FROM "payment_methods"), account_id);
  ELSE
    UPDATE "payment_methods" SET "ledger_account_id" = account_id WHERE "id" = method_id;
  END IF;
END $$;
