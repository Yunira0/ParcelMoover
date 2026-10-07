CREATE INDEX CONCURRENTLY "idx_settlements_vendor_created_id"
ON "public"."settlements" ("vendor_id", "created_at" DESC, "id" DESC);
