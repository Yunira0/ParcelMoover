-- Pair with the native parcel_status predicate in dashboard.ts.
CREATE INDEX CONCURRENTLY "idx_parcel_history_status_created_parcel"
ON "public"."parcel_status_history" ("new_status", "created_at", "parcel_id");
