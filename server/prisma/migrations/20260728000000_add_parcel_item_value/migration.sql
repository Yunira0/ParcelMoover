-- Add item_value to parcels (declared insurable/item value, separate from COD)
ALTER TABLE "parcels" ADD COLUMN "item_value" DECIMAL(12,2) NOT NULL DEFAULT 0;
