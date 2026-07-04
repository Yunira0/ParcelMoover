-- Run sheets: one persisted record per hand-off batch (parcels sent out for
-- delivery with a rider). Mirrors the dispatches/dispatch_parcels pattern.

-- CreateTable
CREATE TABLE "run_sheets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sheet_no" TEXT NOT NULL,
    "rider_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_sheet_parcels" (
    "run_sheet_id" UUID NOT NULL,
    "parcel_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_sheet_parcels_pkey" PRIMARY KEY ("run_sheet_id", "parcel_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "run_sheets_sheet_no_key" ON "run_sheets"("sheet_no");

-- CreateIndex
CREATE INDEX "idx_run_sheets_rider_created" ON "run_sheets"("rider_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_run_sheets_created_at" ON "run_sheets"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_run_sheet_parcels_parcel_id" ON "run_sheet_parcels"("parcel_id");

-- AddForeignKey
ALTER TABLE "run_sheets" ADD CONSTRAINT "run_sheets_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "run_sheets" ADD CONSTRAINT "run_sheets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "run_sheet_parcels" ADD CONSTRAINT "run_sheet_parcels_run_sheet_id_fkey" FOREIGN KEY ("run_sheet_id") REFERENCES "run_sheets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "run_sheet_parcels" ADD CONSTRAINT "run_sheet_parcels_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
