-- Flags a `riders` row as a placeholder standing in for an external carrier
-- (not a real ParcelMoover employee), so COD cash can be attributed to the
-- right carrier instead of lumped into "PM-Rider". NULL = genuine internal
-- rider (default/normal case). "PM Rider N" is NCM handled manually (not
-- through the API-tracked handoff flow); "PM Rider U" is Upaya, which has no
-- API integration yet.
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "carrier_code" TEXT;

-- Data fixup: flag the two known placeholder rows by their exact production
-- names. Guarded by carrier_code IS NULL so re-running is harmless.
UPDATE "riders" SET "carrier_code" = 'upaya'
  WHERE "name" ILIKE 'PM Rider U' AND "carrier_code" IS NULL;
UPDATE "riders" SET "carrier_code" = 'ncm'
  WHERE "name" ILIKE 'PM Rider N' AND "carrier_code" IS NULL;
