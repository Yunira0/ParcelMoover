-- AlterTable
-- IF NOT EXISTS: on some databases this column was already added by an
-- earlier, differently-named migration (add_pricing_extra_weight_percent).
ALTER TABLE "pricing_settings" ADD COLUMN IF NOT EXISTS "extra_weight_percent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "extra_weight_percent" DECIMAL(5,2);
