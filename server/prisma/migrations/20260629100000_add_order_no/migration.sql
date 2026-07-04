-- Add sequential order_number to parcels, backfilling existing rows in creation order.
CREATE SEQUENCE IF NOT EXISTS parcels_order_number_seq;

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS order_number INTEGER;

-- Backfill existing rows in ascending creation order
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM parcels
)
UPDATE parcels SET order_number = ordered.rn
FROM ordered WHERE parcels.id = ordered.id;

-- Set sequence to continue from the current max
SELECT setval('parcels_order_number_seq', COALESCE((SELECT MAX(order_number) FROM parcels), 0) + 1);

ALTER SEQUENCE parcels_order_number_seq OWNED BY parcels.order_number;

ALTER TABLE parcels
  ALTER COLUMN order_number SET DEFAULT nextval('parcels_order_number_seq'),
  ALTER COLUMN order_number SET NOT NULL;
