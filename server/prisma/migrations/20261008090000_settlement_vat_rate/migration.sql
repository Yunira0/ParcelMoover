-- The VAT included in a vendor statement's delivery charges, as a percentage.
-- Display only: payable_amount is unchanged. Existing statements keep NULL so
-- they read exactly as they did when created.
ALTER TABLE "settlements" ADD COLUMN "vat_rate" DECIMAL(5,2);
