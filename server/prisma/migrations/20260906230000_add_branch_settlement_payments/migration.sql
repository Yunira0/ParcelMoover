-- Branch statements now follow the same lifecycle as vendor/rider statements:
-- creation earmarks orders, while payments move the statement toward settled.
ALTER TABLE "branch_settlements"
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "payments" JSONB,
  ADD COLUMN "settled_by" UUID,
  ADD COLUMN "settled_at" TIMESTAMPTZ(6);

-- Rows created by the old workflow were completed immediately. Preserve that
-- history as fully paid instead of turning genuine deposits back into pending.
UPDATE "branch_settlements"
   SET "paid_amount" = "net_payable",
       "settled_by" = "created_by",
       "settled_at" = "updated_at"
 WHERE "status" = 'settled';

ALTER TABLE "branch_settlements"
  ADD CONSTRAINT "branch_settlements_status_check"
    CHECK ("status" IN ('pending', 'partially_paid', 'settled', 'cancelled')),
  ADD CONSTRAINT "branch_settlements_paid_amount_check"
    CHECK ("paid_amount" >= 0 AND "paid_amount" <= "net_payable"),
  ADD CONSTRAINT "branch_settlements_settled_by_fkey"
    FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "idx_branch_settlements_status_date"
  ON "branch_settlements"("status", "settlement_date" DESC);

CREATE TABLE "branch_settlement_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "settlement_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" TEXT NOT NULL,
  "breakdown" JSONB NOT NULL,
  "remark" TEXT,
  "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_settlement_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_settlement_payments_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "branch_settlement_payments_settlement_id_fkey"
    FOREIGN KEY ("settlement_id") REFERENCES "branch_settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "branch_settlement_payments_recorded_by_fkey"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_branch_settlement_payments_settlement"
  ON "branch_settlement_payments"("settlement_id", "paid_at");
CREATE INDEX "idx_branch_settlement_payments_recorded_by"
  ON "branch_settlement_payments"("recorded_by");
