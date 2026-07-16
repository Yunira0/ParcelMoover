-- A vendor can combine two rate options: their primary model (per_destination /
-- zone / flat) for most areas, PLUS an optional flat rate that overrides it for
-- inside-valley destinations (keyed off the destination's valley classification).
-- Null = no override; the primary model applies everywhere as before.
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "inside_valley_flat_rate" DECIMAL(12,2);
