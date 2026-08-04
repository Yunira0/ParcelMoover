-- Payment evidence attached when a settlement is paid out.
--
-- Two separate documents rather than one: the receipt proves the transfer
-- happened (bank slip / wallet screenshot), the tax invoice is the accounting
-- artifact raised against it. They arrive at the same moment but are audited
-- by different people, so they get their own columns instead of a single
-- "attachment" that would have to be guessed at later.
--
-- Both nullable: a cash handover across the counter has neither, and existing
-- settled statements predate the feature entirely.

ALTER TABLE "settlements" ADD COLUMN "payment_receipt_path" TEXT;
ALTER TABLE "settlements" ADD COLUMN "tax_invoice_path" TEXT;
