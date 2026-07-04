-- Backfill tracking_id for notifications created before the column was added.
-- Titles follow two patterns:
--   "New reply on order PM-YYMMDD-XXXXXXXXXXXXX-C"
--   "Order PM-YYMMDD-XXXXXXXXXXXXX-C updated"
UPDATE notifications
SET tracking_id = (regexp_match(title, 'PM-[0-9]{6}-[A-Z0-9]{13}-[A-Z0-9]'))[1]
WHERE tracking_id IS NULL
  AND title ~ 'PM-[0-9]{6}-[A-Z0-9]{13}-[A-Z0-9]';
