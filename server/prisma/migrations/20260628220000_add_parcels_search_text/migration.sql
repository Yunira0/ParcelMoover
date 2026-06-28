-- Add denormalized search column to parcels.
-- Stores tracking_id + sender/receiver names + phones in one lowercase string.
-- A single GIN trigram index on this column replaces the multi-JOIN OR query,
-- keeping search fast and O(1) regardless of table size.
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS search_text TEXT;

-- Backfill existing rows by joining to parties for sender/receiver data.
UPDATE parcels p
SET search_text = LOWER(
  p.tracking_id || ' ' ||
  COALESCE(s.name, '')            || ' ' ||
  COALESCE(s.phone, '')           || ' ' ||
  COALESCE(s.alternate_phone, '') || ' ' ||
  COALESCE(r.name, '')            || ' ' ||
  COALESCE(r.phone, '')           || ' ' ||
  COALESCE(r.alternate_phone, '')
)
FROM parties s, parties r
WHERE p.sender_id = s.id AND p.receiver_id = r.id;

-- GIN trigram index — enables fast ILIKE '%term%' on a single column, no JOINs.
CREATE INDEX IF NOT EXISTS idx_parcels_search_text
  ON parcels USING gin(search_text gin_trgm_ops);
