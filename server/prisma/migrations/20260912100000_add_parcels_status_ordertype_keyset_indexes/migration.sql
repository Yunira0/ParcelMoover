-- Composite keyset indexes so a status- or order_type-filtered orders list
-- page (Return Operations, in particular) can seek through the index instead
-- of scanning idx_parcels_order_number_id and filtering every row - order_type
-- had no index at all before this.
--
-- NOTE: parcels is a large, constantly-written table. CREATE INDEX
-- CONCURRENTLY would avoid holding a lock across the build, but this repo's
-- Prisma setup wraps every migration in a transaction and CONCURRENTLY cannot
-- run inside one (confirmed: it errors "cannot run inside a transaction
-- block" under `prisma migrate deploy`). A plain CREATE INDEX briefly locks
-- the table for the duration of the build - consider applying this migration
-- by hand, off-peak, before/instead of the container's automatic
-- `prisma migrate deploy` on startup if that matters for this deployment.
CREATE INDEX IF NOT EXISTS idx_parcels_status_order_number_id
  ON "parcels" (status, order_number DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_parcels_order_type_order_number_id
  ON "parcels" (order_type, order_number DESC, id DESC);
