-- Failed pickups and failed deliveries now carry their own SLA, so an order
-- that fails and then sits untouched shows up under the pickup / delivery
-- "Needs attention" rollups instead of falling out of every group.
INSERT INTO "sla_settings" ("status_key", "sla_hours") VALUES
    ('failed_pickup', 24),
    ('failed_delivery', 24)
ON CONFLICT ("status_key") DO NOTHING;
