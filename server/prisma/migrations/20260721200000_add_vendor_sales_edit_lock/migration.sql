-- Sales staff get exactly one self-service edit on a vendor assigned to
-- them; this timestamp records when that edit was used, and its presence
-- blocks any further sales-side edits on the same vendor.
ALTER TABLE "vendors" ADD COLUMN "sales_edited_at" TIMESTAMPTZ(6);
