-- Links an auto-created return parcel back to the exchange order it was
-- generated from (rider confirms receiving the exchange parcel on delivery).
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "source_order_id" UUID;

ALTER TABLE "parcels"
  ADD CONSTRAINT "parcels_source_order_id_fkey"
  FOREIGN KEY ("source_order_id") REFERENCES "parcels"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "idx_parcels_source_order_id" ON "parcels"("source_order_id");
