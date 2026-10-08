-- Opt-in restriction: when true, this admin's Order Management is scoped to
-- their own location_id's coverage (itself, its covered areas, its virtual
-- branches) instead of seeing every order. Defaults false so no existing
-- admin - many of whom already carry a location_id purely from hub
-- inheritance at account creation, not as an access signal - loses visibility
-- they have today. BRANCH_TRACKING_READ/WRITE lifts the restriction, same as
-- it already does for the dedicated Branch Tracking pages.
ALTER TABLE "admins" ADD COLUMN "branch_scoped" BOOLEAN NOT NULL DEFAULT false;
