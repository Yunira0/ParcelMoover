CREATE INDEX CONCURRENTLY "idx_settlements_rider_created_id"
ON "public"."settlements" ("rider_id", "created_at" DESC, "id" DESC);
