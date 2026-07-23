-- Vendor-declared eligibility flag, set at order creation, letting the
-- Partner API expose "this shipment may be partially accepted" without
-- changing who is allowed to actually mark a parcel partially_delivered.
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "allow_partial_delivery" BOOLEAN NOT NULL DEFAULT false;
