ALTER TABLE "branch_payments" ADD COLUMN "settlement_id" UUID;
ALTER TABLE "branch_payments"
  ADD CONSTRAINT "branch_payments_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "branch_settlements"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX "idx_branch_payments_settlement" ON "branch_payments"("settlement_id");
