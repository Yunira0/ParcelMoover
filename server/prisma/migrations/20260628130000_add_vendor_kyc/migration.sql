-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "vendor_kyc_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "kyc_status" NOT NULL DEFAULT 'pending',
    "business_name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "business_type" TEXT,
    "pan_vat_no" TEXT,
    "id_type" TEXT NOT NULL DEFAULT 'citizenship',
    "id_number" TEXT NOT NULL,
    "website" TEXT,
    "monthly_shipment_estimate" TEXT,
    "description" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "vendor_kyc_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_kyc_status" ON "vendor_kyc_applications"("status");
CREATE INDEX "idx_kyc_created_at" ON "vendor_kyc_applications"("created_at" DESC);
