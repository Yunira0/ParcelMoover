-- Enable the pg_trgm extension for GIN trigram indexes.
-- This allows efficient ILIKE '%term%' queries used in name and location searches.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on parties.name — speeds up sender/receiver name partial search.
CREATE INDEX IF NOT EXISTS idx_parties_name_trgm
  ON parties USING gin(name gin_trgm_ops);

-- GIN trigram index on locations.name — speeds up destination location partial search.
CREATE INDEX IF NOT EXISTS idx_locations_name_trgm
  ON locations USING gin(name gin_trgm_ops);
