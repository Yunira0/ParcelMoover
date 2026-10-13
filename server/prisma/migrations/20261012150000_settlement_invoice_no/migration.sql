-- The vendor's invoice number for a statement's payout, recorded with the
-- payment proof. Optional, so existing statements stay NULL.
ALTER TABLE "settlements" ADD COLUMN "invoice_no" TEXT;
