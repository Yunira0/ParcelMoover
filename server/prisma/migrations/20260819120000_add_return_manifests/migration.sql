-- The hand-over document for the return (RTO) leg.
--
-- Every other batch hand-off in the system already has one of these:
-- run_sheets for sent_for_delivery, dispatches for hub-to-hub dispatched. The
-- return leg was the exception - parcels went back to a vendor one selection at
-- a time, and nothing recorded which parcels travelled together, so there was
-- nothing to hand the rider or the vendor and no way to accumulate a vendor's
-- returns over the days before a pickup actually happens.
--
-- A manifest stays 'open' while parcels are added to it, then moves as a unit:
-- 'sent' takes every member parcel to sent_to_vendor, 'received' to
-- returned_to_vendor. The rider is on the manifest, not the parcel - one person
-- carries the whole hand-over.

CREATE TYPE "return_manifest_status" AS ENUM ('open', 'sent', 'received');

CREATE TABLE "return_manifests" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "manifest_no" TEXT NOT NULL,
    "vendor_id"   UUID NOT NULL,
    "status"      "return_manifest_status" NOT NULL DEFAULT 'open',
    -- Chosen at send time, not at creation: an open manifest is a pile on a
    -- shelf, and who carries it is only known when it actually leaves. Mirrored
    -- onto each member parcel's delivery_rider_id by the sent_to_vendor
    -- transition itself, so COD attribution keeps working unchanged.
    "rider_id"    UUID,
    "created_by"  UUID,
    "sent_by"     UUID,
    "received_by" UUID,
    "sent_at"     TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "remarks"     TEXT,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "return_manifests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "return_manifests_manifest_no_key"
    ON "return_manifests"("manifest_no");

CREATE INDEX "idx_return_manifests_vendor"
    ON "return_manifests"("vendor_id", "created_at" DESC);

CREATE INDEX "idx_return_manifests_status"
    ON "return_manifests"("status", "created_at" DESC);

CREATE INDEX "idx_return_manifests_rider"
    ON "return_manifests"("rider_id");

-- The actual enforcement of "one open manifest per vendor". The service checks
-- it too, for a readable error, but a check-then-insert in application code
-- races: two operators clicking together both see no open manifest and both
-- insert.
--
-- It also does a second job that is easy to miss. A parcel has exactly one
-- vendor, and the add-parcels endpoint refuses any parcel whose vendor differs
-- from the manifest's - so "at most one open manifest per vendor" transitively
-- means a parcel can never sit on two open manifests at once. The direct form
-- of that rule (a partial unique index on parcel_id) is not expressible here:
-- a partial index's WHERE clause can only reference columns of the table being
-- indexed, and the status lives on the parent.
CREATE UNIQUE INDEX "return_manifests_one_open_per_vendor"
    ON "return_manifests"("vendor_id")
    WHERE "status" = 'open';

ALTER TABLE "return_manifests" ADD CONSTRAINT "return_manifests_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "return_manifests" ADD CONSTRAINT "return_manifests_rider_id_fkey"
    FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "return_manifests" ADD CONSTRAINT "return_manifests_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "return_manifests" ADD CONSTRAINT "return_manifests_sent_by_fkey"
    FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "return_manifests" ADD CONSTRAINT "return_manifests_received_by_fkey"
    FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Membership as a join table rather than a parcels.return_manifest_id column:
-- parcels already carries 15 btree indexes plus a GIN trigram index, nothing
-- needs manifest data on the orders hot path, and this keeps the history when a
-- parcel is force-reverted and later returns on a second manifest.
CREATE TABLE "return_manifest_parcels" (
    "return_manifest_id" UUID NOT NULL,
    "parcel_id"          UUID NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "return_manifest_parcels_pkey" PRIMARY KEY ("return_manifest_id", "parcel_id")
);

CREATE INDEX "idx_return_manifest_parcels_parcel_id"
    ON "return_manifest_parcels"("parcel_id");

ALTER TABLE "return_manifest_parcels" ADD CONSTRAINT "return_manifest_parcels_return_manifest_id_fkey"
    FOREIGN KEY ("return_manifest_id") REFERENCES "return_manifests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "return_manifest_parcels" ADD CONSTRAINT "return_manifest_parcels_parcel_id_fkey"
    FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
