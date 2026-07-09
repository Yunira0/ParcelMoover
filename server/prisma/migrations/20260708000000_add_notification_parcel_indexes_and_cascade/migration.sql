-- notifications: every list/count/unread-count/mark-all-read query filters by
-- user_id (some also by read_at IS NULL), and this table has had zero indexes
-- beyond the primary key - every one of those queries has been a full table scan.
CREATE INDEX IF NOT EXISTS "idx_notifications_user_read" ON "notifications" ("user_id", "read_at");

-- parcels: the staff-scoped dashboard summary (getDashboardSummary) runs ~16
-- separate status-filtered counts with no other selective predicate for
-- super_admin/admin actors (vendor/rider scoping is undefined for them), so
-- there's nothing else for the planner to narrow on without this.
CREATE INDEX IF NOT EXISTS "idx_parcels_status" ON "parcels" ("status");

-- settlement_items.cod_collection_id: bring in line with its sibling
-- settlement_id FK, which already cascades. No code path hard-deletes a
-- cod_collections row today (parcels/cod_collections are only ever
-- soft-deleted via deleted_at), so this is a consistency fix rather than a
-- fix for an observed failure.
ALTER TABLE "settlement_items" DROP CONSTRAINT IF EXISTS "settlement_items_cod_collection_id_fkey";
ALTER TABLE "settlement_items"
  ADD CONSTRAINT "settlement_items_cod_collection_id_fkey"
  FOREIGN KEY ("cod_collection_id") REFERENCES "cod_collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
