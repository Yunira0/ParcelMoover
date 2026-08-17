-- The 20260809180000_add_riders_carrier_code migration flagged the two known
-- carrier-placeholder riders by matching the exact strings 'PM Rider U' and
-- 'PM Rider N'. Production's actual rider names are 'PM RIDER - U' and
-- 'PM RIDER - N' (hyphenated, different casing/spacing), so that ILIKE match
-- never fired: both rows have carrier_code IS NULL to this day, silently
-- misattributing their COD into the "PM-Rider" dashboard bucket instead of
-- 3PL - NCM / 3PL - Upaya (confirmed on prod: 53 parcels / Rs 44,170 for the
-- NCM placeholder, 190 parcels / Rs 225,957 for the Upaya placeholder).
--
-- Match on the name with everything but letters/digits stripped, so spacing
-- and punctuation drift (space vs hyphen vs none) can't cause this to
-- silently miss again. Still guarded by carrier_code IS NULL, so re-running
-- is harmless and it won't clobber a value set through the admin UI.
UPDATE "riders" SET "carrier_code" = 'upaya'
  WHERE regexp_replace(upper("name"), '[^A-Z0-9]', '', 'g') = 'PMRIDERU'
    AND "carrier_code" IS NULL;
UPDATE "riders" SET "carrier_code" = 'ncm'
  WHERE regexp_replace(upper("name"), '[^A-Z0-9]', '', 'g') = 'PMRIDERN'
    AND "carrier_code" IS NULL;
