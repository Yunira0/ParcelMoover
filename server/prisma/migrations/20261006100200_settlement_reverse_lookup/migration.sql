-- The primary key starts with settlement_id; this covers the reverse lookup.
CREATE INDEX CONCURRENTLY "idx_settlement_items_cod_settlement"
ON "public"."settlement_items" ("cod_collection_id", "settlement_id");
