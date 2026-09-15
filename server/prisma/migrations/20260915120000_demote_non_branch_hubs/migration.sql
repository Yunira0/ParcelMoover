-- Destinations used to be created with is_hub = true, so a plain destination
-- looked like a branch to branch balances, Branch Overview, the hub pickers and
-- the Rates origin list. Only Add Branch should make a branch.
--
-- Un-mark top-level hubs that are none of: Imadol (head office), created or
-- promoted through Add Branch (audit log, or the commission it always sets).
-- A location that still has admins, riders or vendors assigned is left alone:
-- demoting it would break their branch scope. Same rules as
-- scripts/demote-non-branch-hubs.ts, which reports those for manual follow-up.
UPDATE "locations" AS l
SET "is_hub" = false, "updated_at" = now()
WHERE l."parent_id" IS NULL
  AND l."is_hub" = true
  AND UPPER(TRIM(COALESCE(l."code", ''))) <> 'IMADOL'
  AND l."commission_per_parcel" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a."entity_type" = 'branch'
      AND a."action" = 'CREATE_OR_PROMOTE_BRANCH'
      AND a."entity_id" = l."id"
  )
  AND NOT EXISTS (SELECT 1 FROM "admins" x WHERE x."location_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "riders" x WHERE x."location_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "vendors" x WHERE x."location_id" = l."id");
