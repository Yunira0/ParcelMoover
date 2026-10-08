-- 3PL (NCM / Upaya) COD settlements. Schema only: which existing collections a
-- carrier delivered is backfilled separately.

ALTER TABLE "cod_collections"
  ADD COLUMN "carrier_code" TEXT,
  ADD COLUMN "carrier_payment_status" "payment_status" NOT NULL DEFAULT 'pending',
  ADD COLUMN "carrier_remitted_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "carrier_settled_at" TIMESTAMPTZ(6);
CREATE INDEX "idx_cod_collections_carrier_status" ON "cod_collections"("carrier_code", "carrier_payment_status");

CREATE TABLE "carrier_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "statement_no" TEXT NOT NULL,
    "carrier_code" TEXT NOT NULL,
    "settlement_date" DATE NOT NULL,
    "gross_cod" DECIMAL(12,2) NOT NULL,
    "carrier_charges" DECIMAL(12,2) NOT NULL,
    "net_receivable" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_method" TEXT,
    "payments" JSONB,
    "remark" TEXT,
    "created_by" UUID,
    "settled_by" UUID,
    "settled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "carrier_settlements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "carrier_settlements_statement_no_key" ON "carrier_settlements"("statement_no");
CREATE INDEX "idx_carrier_settlements_carrier_status" ON "carrier_settlements"("carrier_code", "status", "settlement_date" DESC);

CREATE TABLE "carrier_settlement_items" (
    "settlement_id" UUID NOT NULL,
    "cod_collection_id" UUID NOT NULL,
    "collected_amount" DECIMAL(12,2) NOT NULL,
    "carrier_charge" DECIMAL(12,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "carrier_settlement_items_pkey" PRIMARY KEY ("settlement_id","cod_collection_id")
);
CREATE UNIQUE INDEX "carrier_settlement_items_cod_collection_id_key" ON "carrier_settlement_items"("cod_collection_id");
ALTER TABLE "carrier_settlement_items" ADD CONSTRAINT "carrier_settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "carrier_settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "carrier_settlement_items" ADD CONSTRAINT "carrier_settlement_items_cod_collection_id_fkey" FOREIGN KEY ("cod_collection_id") REFERENCES "cod_collections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "carrier_settlement_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "settlement_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "remark" TEXT,
    "proof_path" TEXT,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,
    CONSTRAINT "carrier_settlement_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_carrier_settlement_payments_settlement" ON "carrier_settlement_payments"("settlement_id", "paid_at");
ALTER TABLE "carrier_settlement_payments" ADD CONSTRAINT "carrier_settlement_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "carrier_settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Ledger: what a carrier still owes us, and what it kept as its charge.
INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_side", "is_control", "subledger_type", "description")
VALUES
  ('1020', 'COD with 3PL', 'asset', 'debit', false, NULL,
   'COD a 3PL carrier (NCM, Upaya) has put on a statement to us but not yet paid. Debited when the statement is raised, cleared as its instalments land.'),
  ('5020', '3PL Delivery Charge', 'expense', 'debit', false, NULL,
   'Per-order delivery charge a 3PL carrier keeps out of the COD it remits to us.')
ON CONFLICT ("code") DO NOTHING;
