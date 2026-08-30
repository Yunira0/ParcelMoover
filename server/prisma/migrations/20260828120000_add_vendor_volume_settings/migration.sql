-- Single-row settings table for the Vendor Management "High volume vendor"
-- filter: a vendor qualifies once any one calendar day's parcel count
-- exceeds high_volume_daily_parcels. Previously hardcoded to 100 total
-- lifetime orders in application code; now a super-admin-tunable daily
-- threshold, one row enforced by application code rather than a DB constraint
-- (matching pricing_settings/billing_settings).

CREATE TABLE "vendor_volume_settings" (
    "id"                         UUID NOT NULL DEFAULT gen_random_uuid(),
    "high_volume_daily_parcels"  INTEGER NOT NULL DEFAULT 100,
    "updated_at"                 TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "vendor_volume_settings_pkey" PRIMARY KEY ("id")
);
