-- Supplier bills entered by finance staff for the VAT Purchase Register.
CREATE TABLE "purchase_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_date" DATE NOT NULL,
    "bill_no" TEXT NOT NULL,
    "customs_no" TEXT,
    "supplier_name" TEXT NOT NULL,
    "supplier_pan" TEXT,
    "purchase_type" TEXT NOT NULL DEFAULT 'local',
    "description" TEXT,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "exempt_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(12,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_remark" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_bills_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_purchase_bills_bill_date" ON "purchase_bills"("bill_date");
CREATE INDEX "idx_purchase_bills_cancelled_at" ON "purchase_bills"("cancelled_at");
