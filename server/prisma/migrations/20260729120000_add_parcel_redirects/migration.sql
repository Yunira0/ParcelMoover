-- Redirect log: the customer moved after the parcel was already booked (or is
-- already in the network), so ops points it at a different destination branch /
-- address. Kept as its own record - not just a parcel edit - because the reason
-- and the charge added for the diversion have to survive later rate changes.
CREATE TABLE "parcel_redirects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parcel_id" UUID NOT NULL,
    "from_location_id" UUID,
    "to_location_id" UUID NOT NULL,
    "from_address" TEXT,
    "to_address" TEXT,
    "reason" TEXT NOT NULL,
    "status_at_redirect" "parcel_status" NOT NULL,
    "old_delivery_charge" DECIMAL(12,2) NOT NULL,
    "redirect_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "new_delivery_charge" DECIMAL(12,2) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "parcel_redirects_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "parcel_redirects" ADD CONSTRAINT "parcel_redirects_parcel_id_fkey"
    FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "parcel_redirects" ADD CONSTRAINT "parcel_redirects_from_location_id_fkey"
    FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "parcel_redirects" ADD CONSTRAINT "parcel_redirects_to_location_id_fkey"
    FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "parcel_redirects" ADD CONSTRAINT "parcel_redirects_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_parcel_redirects_parcel_id" ON "parcel_redirects"("parcel_id", "created_at" DESC);
CREATE INDEX "idx_parcel_redirects_to_location" ON "parcel_redirects"("to_location_id");
CREATE INDEX "idx_parcel_redirects_created_at" ON "parcel_redirects"("created_at" DESC);
