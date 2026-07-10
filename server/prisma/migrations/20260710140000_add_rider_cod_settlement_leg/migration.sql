-- AlterTable
ALTER TABLE "cod_collections" ADD COLUMN "rider_remitted_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "rider_payment_status" "payment_status" NOT NULL DEFAULT 'pending',
ADD COLUMN "rider_settled_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "idx_cod_collections_rider_payment_status" ON "cod_collections"("rider_id", "rider_payment_status");
