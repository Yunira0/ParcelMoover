-- Explicit Upaya delivery-area override for locations, the Upaya twin of ncm_branch
ALTER TABLE "locations" ADD COLUMN "upaya_area_id" INTEGER;
