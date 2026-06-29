-- Add alternate_phone to parties.
-- This column exists in schema.prisma but was never added by a migration
-- (it had been applied via `db push` in some environments). The later
-- 20260628220000_add_parcels_search_text migration references it during
-- backfill, so it must exist before that migration runs.
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "alternate_phone" TEXT;
