-- Vendor notice popup banner concept removed entirely (client, server, and
-- schema). Drop dependents before the parent table.
DROP TABLE IF EXISTS "vendor_notice_dismissals";
DROP TABLE IF EXISTS "vendor_notice_targets";
DROP TABLE IF EXISTS "vendor_notices";
