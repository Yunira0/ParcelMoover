-- Add threaded-reply support to parcel_remarks
ALTER TABLE "parcel_remarks" ADD COLUMN "parent_remark_id" UUID;

CREATE INDEX "idx_parcel_remarks_parent_remark_id" ON "parcel_remarks"("parent_remark_id");

ALTER TABLE "parcel_remarks" ADD CONSTRAINT "parcel_remarks_parent_remark_id_fkey" FOREIGN KEY ("parent_remark_id") REFERENCES "parcel_remarks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
