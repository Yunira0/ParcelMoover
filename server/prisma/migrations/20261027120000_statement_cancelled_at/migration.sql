-- When a vendor or carrier statement was cancelled, for the VAT return registers.
ALTER TABLE "settlements" ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);
ALTER TABLE "carrier_settlements" ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);

-- Backfill from the cancel audit entry; updated_at where there is none.
UPDATE "settlements" s
SET "cancelled_at" = COALESCE(
  (SELECT MAX(a."created_at") FROM "audit_logs" a
   WHERE a."entity_type" = 'settlement' AND a."entity_id" = s."id" AND a."action" = 'CANCEL_SETTLEMENT'),
  s."updated_at")
WHERE s."status" = 'cancelled';

UPDATE "carrier_settlements" c
SET "cancelled_at" = COALESCE(
  (SELECT MAX(a."created_at") FROM "audit_logs" a
   WHERE a."entity_type" = 'carrier_settlement' AND a."entity_id" = c."id" AND a."action" = 'CANCEL_CARRIER_SETTLEMENT'),
  c."updated_at")
WHERE c."status" = 'cancelled';

CREATE INDEX "idx_settlements_cancelled_at" ON "settlements"("cancelled_at");
CREATE INDEX "idx_carrier_settlements_cancelled_at" ON "carrier_settlements"("cancelled_at");
