CREATE TYPE "branch_payment_status" AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE "branch_billing_state" AS ENUM ('ok', 'warned', 'blocked');

ALTER TABLE "locations"
  ADD COLUMN "branch_billing_warn_threshold" DECIMAL(12,2),
  ADD COLUMN "branch_billing_block_threshold" DECIMAL(12,2),
  ADD COLUMN "branch_billing_alert_state" "branch_billing_state" NOT NULL DEFAULT 'ok',
  ADD COLUMN "branch_billing_alert_at" TIMESTAMPTZ(6);

ALTER TABLE "billing_settings"
  ADD COLUMN "branch_warn_threshold" DECIMAL(12,2) NOT NULL DEFAULT -50000,
  ADD COLUMN "branch_block_threshold" DECIMAL(12,2) NOT NULL DEFAULT -75000;

CREATE TABLE "branch_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'fonepay',
  "reference" TEXT,
  "proof_path" TEXT,
  "status" "branch_payment_status" NOT NULL DEFAULT 'pending',
  "note" TEXT,
  "submitted_by" UUID,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "review_remark" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_payments_amount_positive" CHECK ("amount" > 0)
);

ALTER TABLE "branch_payments"
  ADD CONSTRAINT "branch_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "branch_payments_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "branch_payments_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "idx_branch_payments_branch_status" ON "branch_payments"("branch_id", "status");
CREATE INDEX "idx_branch_payments_status_created" ON "branch_payments"("status", "created_at" DESC);
