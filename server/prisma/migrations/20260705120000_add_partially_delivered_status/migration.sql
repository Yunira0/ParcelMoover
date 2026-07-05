-- AlterEnum
ALTER TYPE "parcel_status" ADD VALUE 'partially_delivered' BEFORE 'failed_pickup';

-- AlterTable
ALTER TABLE "parcels" ADD COLUMN "partial_delivery_remarks" TEXT,
ADD COLUMN "partial_cod_collected" DECIMAL(12,2);
