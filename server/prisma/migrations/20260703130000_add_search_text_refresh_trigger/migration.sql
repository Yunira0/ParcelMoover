-- parcels.search_text is only computed once at parcel creation. Nothing in
-- the app currently edits a party's name/phone/alternate_phone after a parcel
-- references it, so this has been harmless - but there's no code path
-- guaranteeing that stays true. A DB-level trigger closes the gap permanently:
-- it fires regardless of which application code path (present or future)
-- updates a party, so search_text can't silently go stale.

CREATE OR REPLACE FUNCTION refresh_parcel_search_text_for_party()
RETURNS trigger AS $$
BEGIN
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
  WHERE p.sender_id = s.id
    AND p.receiver_id = r.id
    AND (p.sender_id = NEW.id OR p.receiver_id = NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_parcel_search_text ON parties;

CREATE TRIGGER trg_refresh_parcel_search_text
AFTER UPDATE OF name, phone, alternate_phone ON parties
FOR EACH ROW
WHEN (
  NEW.name IS DISTINCT FROM OLD.name OR
  NEW.phone IS DISTINCT FROM OLD.phone OR
  NEW.alternate_phone IS DISTINCT FROM OLD.alternate_phone
)
EXECUTE FUNCTION refresh_parcel_search_text_for_party();
