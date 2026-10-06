-- Vendor Billing payments become credit that statements apply.
--
-- A vendor who paid delivery charges through Billing had those same charges
-- deducted again from the next statement (payable = COD - charges, with no
-- regard for what was prepaid). The overpayment only survived as a positive
-- balance nobody paid out. Statements now carry the credit they hand back.
ALTER TABLE "settlements"
    ADD COLUMN "vendor_credit_applied" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Rows already on file take `false`: those payments were squared against
-- statements by hand (often by recording the vendor's side of a statement as
-- paid), so applying them again would pay the same money out twice. Every
-- payment recorded from here on takes the new default.
ALTER TABLE "vendor_payments"
    ADD COLUMN "counts_toward_statements" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vendor_payments"
    ALTER COLUMN "counts_toward_statements" SET DEFAULT true;
