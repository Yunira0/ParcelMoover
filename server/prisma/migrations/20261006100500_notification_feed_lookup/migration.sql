-- Keep idx_notifications_user_read for unread counts; this covers the feed.
CREATE INDEX CONCURRENTLY "idx_notifications_user_created_id"
ON "public"."notifications" ("user_id", "created_at" DESC, "id" DESC);
