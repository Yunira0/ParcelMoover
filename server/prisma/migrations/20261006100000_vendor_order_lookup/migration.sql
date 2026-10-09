-- One statement per migration: PostgreSQL concurrent builds cannot run in a
-- transaction. Keep this separate from other DDL and do not add BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY "idx_parcels_vendor_order_number_id"
ON "public"."parcels" ("vendor_id", "order_number" DESC, "id" DESC);
