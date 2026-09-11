-- branch_scoped is no longer a manual toggle: every hub except Imadol
-- automatically gets the branch workspace. Backfill every existing admin's
-- branch_scoped from their current hub so behavior matches the new
-- server-side derivation (see deriveBranchScoped in lib/branchScope.ts)
-- immediately, not just for admins created/edited after this ships.
UPDATE "admins" a
SET "branch_scoped" = (UPPER(TRIM(l."code")) IS DISTINCT FROM 'IMADOL')
FROM "locations" l
WHERE a."location_id" = l."id";

UPDATE "admins" SET "branch_scoped" = false WHERE "location_id" IS NULL;
