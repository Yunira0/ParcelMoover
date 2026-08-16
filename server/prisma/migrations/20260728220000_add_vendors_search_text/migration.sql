-- Add denormalized search column to vendors, same pattern as
-- parcels.search_text (20260628220000_add_parcels_search_text): the vendor
-- picker/filter dropdowns search business_name + client_name + phone + email
-- via a 4-way ILIKE OR, which is a full table scan at any real vendor count -
-- pg_trgm can't use a GIN index across an OR of separate columns. Folding
-- them into one lowercase column with a single GIN trigram index keeps search
-- fast and O(1) regardless of table size, same as it did for parcels.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS search_text TEXT;

UPDATE vendors
SET search_text = LOWER(
  COALESCE(business_name, '') || ' ' ||
  COALESCE(client_name, '')   || ' ' ||
  COALESCE(phone, '')         || ' ' ||
  COALESCE(email, '')
);

CREATE INDEX IF NOT EXISTS idx_vendors_search_text
  ON vendors USING gin(search_text gin_trgm_ops);

-- Unlike parcels.search_text (which joins out to parties), every source
-- column here lives on the vendors row itself, so a plain BEFORE trigger can
-- set NEW.search_text directly - no cross-table UPDATE needed.
CREATE OR REPLACE FUNCTION refresh_vendor_search_text()
RETURNS trigger AS $$
BEGIN
  NEW.search_text := LOWER(
    COALESCE(NEW.business_name, '') || ' ' ||
    COALESCE(NEW.client_name, '')   || ' ' ||
    COALESCE(NEW.phone, '')         || ' ' ||
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_vendor_search_text ON vendors;

CREATE TRIGGER trg_refresh_vendor_search_text
BEFORE INSERT OR UPDATE OF business_name, client_name, phone, email ON vendors
FOR EACH ROW
EXECUTE FUNCTION refresh_vendor_search_text();
