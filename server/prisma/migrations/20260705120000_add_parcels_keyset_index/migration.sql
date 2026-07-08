-- Keyset pagination: the orders list default sort is (order_number DESC, id DESC).
-- This composite index lets each page seek straight to the cursor row instead
-- of sorting/scanning; Postgres can walk it in either direction, so it also
-- serves ASC and the backwards ("prev") fetches.
CREATE INDEX IF NOT EXISTS "idx_parcels_order_number_id" ON "parcels"("order_number" DESC, "id" DESC);
