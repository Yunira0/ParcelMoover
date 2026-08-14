-- Partial settlement payments, and one proof per payment.
--
-- Until now a statement was paid in exactly one act: `settlements.payments`
-- held the {method, amount} lines of that act, and `payment_receipt_path` /
-- `tax_invoice_path` held its evidence. Both assumptions break as soon as a
-- payout clears in instalments — Rs. 1,000 today, Rs. 2,000 next week. The
-- second payment would overwrite the first one's methods and its receipt, and
-- nothing would record that the payee was still owed money in between.
--
-- So the act of paying becomes a row (settlement_payments) and the evidence
-- becomes a row (settlement_documents), leaving the settlements columns as a
-- roll-up for the statement header.

-- How much has actually been handed over so far. Derivable by summing
-- settlement_payments, but stored because the statement list ranks and filters
-- on it and would otherwise need a correlated aggregate per row.
ALTER TABLE "settlements"
    ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- One instalment. `breakdown` keeps the existing "one payment may still be
-- split across methods" behaviour (part cash, part bank, handed over together)
-- while `amount` is what that act was worth in total.
CREATE TABLE "settlement_payments" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "settlement_id" UUID NOT NULL,
    "amount"        DECIMAL(12,2) NOT NULL,
    "method"        TEXT NOT NULL,
    "breakdown"     JSONB NOT NULL,
    "remark"        TEXT,
    "paid_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "recorded_by"   UUID,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "settlement_payments_pkey" PRIMARY KEY ("id"),
    -- A zero-amount instalment is legitimate (a statement can total Rs. 0 when
    -- every bundled order was corrected to zero COD), a negative one never is.
    CONSTRAINT "settlement_payments_amount_not_negative" CHECK ("amount" >= 0)
);

ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_settlement_id_fkey"
    FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_recorded_by_fkey"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_settlement_payments_settlement_id" ON "settlement_payments"("settlement_id");

-- One uploaded file. `settlement_payment_id` ties a receipt to the instalment
-- it proves; null means it covers the statement as a whole (a tax invoice
-- raised for the full payout, or anything attached before instalments existed).
-- Several rows of the same kind against the same payment is the normal case,
-- not an error: staff photograph the slip and the ledger page separately.
CREATE TABLE "settlement_documents" (
    "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
    "settlement_id"         UUID NOT NULL,
    "settlement_payment_id" UUID,
    "kind"                  TEXT NOT NULL,
    "file_path"             TEXT NOT NULL,
    "uploaded_by"           UUID,
    "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "settlement_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_documents_kind_check" CHECK ("kind" IN ('receipt', 'tax_invoice'))
);

ALTER TABLE "settlement_documents" ADD CONSTRAINT "settlement_documents_settlement_id_fkey"
    FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "settlement_documents" ADD CONSTRAINT "settlement_documents_settlement_payment_id_fkey"
    FOREIGN KEY ("settlement_payment_id") REFERENCES "settlement_payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "settlement_documents" ADD CONSTRAINT "settlement_documents_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_settlement_documents_settlement_kind" ON "settlement_documents"("settlement_id", "kind");
CREATE INDEX "idx_settlement_documents_payment_id" ON "settlement_documents"("settlement_payment_id");

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Every statement already settled was paid in full in one act, so it becomes
-- exactly one instalment. Without this the detail page would show a settled
-- statement with an empty payment history.

UPDATE "settlements"
SET "paid_amount" = ABS(COALESCE("payable_amount", "amount"))
WHERE "status" = 'settled';

INSERT INTO "settlement_payments" ("settlement_id", "amount", "method", "breakdown", "remark", "paid_at", "recorded_by", "created_at")
SELECT
    s."id",
    ABS(COALESCE(s."payable_amount", s."amount")),
    COALESCE(s."payment_method", 'Recorded'),
    -- Reuse the stored lines when they're there; synthesise a single line from
    -- the summary column for the oldest rows, which predate `payments`.
    CASE
        WHEN jsonb_typeof(s."payments") = 'array' AND jsonb_array_length(s."payments") > 0
            THEN s."payments"
        ELSE jsonb_build_array(jsonb_build_object(
            'method', COALESCE(s."payment_method", 'Recorded'),
            'amount', ABS(COALESCE(s."payable_amount", s."amount"))
        ))
    END,
    s."remark",
    -- No payment timestamp was ever stored; updated_at is the closest thing,
    -- since flipping to settled was the last write for most of these rows.
    s."updated_at",
    s."settled_by",
    s."updated_at"
FROM "settlements" s
WHERE s."status" = 'settled';

-- Existing evidence moves to the new table, attached to the instalment above.
INSERT INTO "settlement_documents" ("settlement_id", "settlement_payment_id", "kind", "file_path", "uploaded_by", "created_at")
SELECT s."id", sp."id", 'receipt', s."payment_receipt_path", s."settled_by", s."updated_at"
FROM "settlements" s
JOIN "settlement_payments" sp ON sp."settlement_id" = s."id"
WHERE s."payment_receipt_path" IS NOT NULL;

INSERT INTO "settlement_documents" ("settlement_id", "settlement_payment_id", "kind", "file_path", "uploaded_by", "created_at")
SELECT s."id", sp."id", 'tax_invoice', s."tax_invoice_path", s."settled_by", s."updated_at"
FROM "settlements" s
JOIN "settlement_payments" sp ON sp."settlement_id" = s."id"
WHERE s."tax_invoice_path" IS NOT NULL;

-- settlements.payment_receipt_path / tax_invoice_path are deliberately left in
-- place rather than dropped: they are the fallback for any row this backfill
-- missed, and dropping them would make the migration unrecoverable. Nothing
-- writes them from here on.
