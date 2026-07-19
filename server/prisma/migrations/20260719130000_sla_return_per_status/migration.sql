-- Return SLA is now per-status (follow_up, ready_to_return, sent_to_vendor)
-- instead of a single 'return' key. Seed the new keys and drop the old one.
INSERT INTO "sla_settings" ("status_key", "sla_hours") VALUES
    ('follow_up', 72),
    ('ready_to_return', 72),
    ('sent_to_vendor', 72)
ON CONFLICT ("status_key") DO NOTHING;

DELETE FROM "sla_settings" WHERE "status_key" = 'return';
