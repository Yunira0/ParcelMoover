ALTER TABLE "locations"
  ADD COLUMN "commission_per_parcel" DECIMAL(12,2);

CREATE TABLE "branch_settlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "statement_no" TEXT NOT NULL,
  "from_branch_id" UUID NOT NULL,
  "to_branch_id" UUID NOT NULL,
  "settlement_date" DATE NOT NULL,
  "commission_per_parcel" DECIMAL(12,2) NOT NULL,
  "gross_cod" DECIMAL(12,2) NOT NULL,
  "commission_amount" DECIMAL(12,2) NOT NULL,
  "net_payable" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'settled',
  "payment_method" TEXT,
  "remark" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_settlements_statement_no_key" UNIQUE ("statement_no"),
  CONSTRAINT "branch_settlements_distinct_branches" CHECK ("from_branch_id" <> "to_branch_id"),
  CONSTRAINT "branch_settlements_non_negative" CHECK (
    "commission_per_parcel" >= 0 AND "gross_cod" >= 0 AND
    "commission_amount" >= 0 AND "net_payable" >= 0
  ),
  CONSTRAINT "branch_settlements_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "branch_settlements_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "branch_settlements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "branch_settlement_items" (
  "settlement_id" UUID NOT NULL,
  "parcel_id" UUID NOT NULL,
  "collected_amount" DECIMAL(12,2) NOT NULL,
  "commission_amount" DECIMAL(12,2) NOT NULL,
  "net_payable" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_settlement_items_pkey" PRIMARY KEY ("settlement_id", "parcel_id"),
  CONSTRAINT "branch_settlement_items_parcel_id_key" UNIQUE ("parcel_id"),
  CONSTRAINT "branch_settlement_items_non_negative" CHECK (
    "collected_amount" >= 0 AND "commission_amount" >= 0 AND "net_payable" >= 0
  ),
  CONSTRAINT "branch_settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "branch_settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "branch_settlement_items_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_branch_settlements_route_date"
  ON "branch_settlements"("from_branch_id", "to_branch_id", "settlement_date" DESC);
CREATE INDEX "idx_branch_settlements_created_by"
  ON "branch_settlements"("created_by");
CREATE INDEX "idx_branch_settlement_items_settlement"
  ON "branch_settlement_items"("settlement_id");
