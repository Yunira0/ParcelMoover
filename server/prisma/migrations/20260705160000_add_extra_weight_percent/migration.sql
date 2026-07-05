-- AlterTable
ALTER TABLE "pricing_settings" ADD COLUMN "extra_weight_percent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "extra_weight_percent" DECIMAL(5,2);
