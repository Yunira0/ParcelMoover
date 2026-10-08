-- The hand-over document for the hub-to-hub (transit) leg.
--
-- Dispatch (oov → dispatched) and receive (dispatched → arrived_at_branch)
-- already work parcel-by-parcel from Transit Operations, but nothing records
-- which parcels travelled together on one truck, and nothing lets a shift
-- accumulate a route's parcels before they leave. The delivery leg has
-- run_sheets for this, the return leg has return_manifests - the transit leg
-- was the exception, and its dashboard tabs called /transit-manifests
-- endpoints that did not exist yet.
--
-- A manifest stays 'open' while oov parcels are scanned onto it; the first
-- successful scan dispatches it (members move to 'dispatched'). The destination
-- branch scans members in (→ 'arrived_at_branch'); once no 'dispatched' member
-- remains the manifest becomes 'received'. Like the return manifest, the parcel
-- transitions themselves run through bulkUpdateParcelStatus rather than being
-- written by the manifest service.
--
-- Unlike the return leg this groups by route, not by vendor - one truck carries
-- many vendors' parcels - so there is deliberately no one-open-per-route
-- uniqueness: several open manifests may accumulate for the same route.

CREATE TYPE "transit_manifest_status" AS ENUM ('open', 'dispatched', 'received');

CREATE TABLE "transit_manifests" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "manifest_no"      TEXT NOT NULL,
    "status"           "transit_manifest_status" NOT NULL DEFAULT 'open',
    -- Resolved from the from_hub/to_hub names at creation; nullable so a
    -- manifest survives its locations being renamed or removed. The text names
    -- are the display record, the ids drive dispatch routing.
    "from_location_id" UUID,
    "to_location_id"   UUID,
    "from_hub"         TEXT NOT NULL,
    "to_hub"           TEXT NOT NULL,
    "created_by"       UUID,
    "dispatched_by"    UUID,
    "received_by"      UUID,
    "dispatched_at"    TIMESTAMPTZ(6),
    "received_at"      TIMESTAMPTZ(6),
    "remarks"          TEXT,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "transit_manifests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transit_manifests_manifest_no_key"
    ON "transit_manifests"("manifest_no");

CREATE INDEX "idx_transit_manifests_status"
    ON "transit_manifests"("status", "created_at" DESC);

CREATE INDEX "idx_transit_manifests_route"
    ON "transit_manifests"("from_location_id", "to_location_id");

ALTER TABLE "transit_manifests" ADD CONSTRAINT "transit_manifests_from_location_id_fkey"
    FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "transit_manifests" ADD CONSTRAINT "transit_manifests_to_location_id_fkey"
    FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "transit_manifests" ADD CONSTRAINT "transit_manifests_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "transit_manifests" ADD CONSTRAINT "transit_manifests_dispatched_by_fkey"
    FOREIGN KEY ("dispatched_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "transit_manifests" ADD CONSTRAINT "transit_manifests_received_by_fkey"
    FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Membership as a join table rather than a parcels.transit_manifest_id column,
-- for the same reasons as return_manifest_parcels: nothing needs manifest data
-- on the orders hot path, and this keeps the history when a parcel later
-- travels on a second manifest.
CREATE TABLE "transit_manifest_parcels" (
    "transit_manifest_id" UUID NOT NULL,
    "parcel_id"           UUID NOT NULL,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "transit_manifest_parcels_pkey" PRIMARY KEY ("transit_manifest_id", "parcel_id")
);

CREATE INDEX "idx_transit_manifest_parcels_parcel_id"
    ON "transit_manifest_parcels"("parcel_id");

ALTER TABLE "transit_manifest_parcels" ADD CONSTRAINT "transit_manifest_parcels_transit_manifest_id_fkey"
    FOREIGN KEY ("transit_manifest_id") REFERENCES "transit_manifests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "transit_manifest_parcels" ADD CONSTRAINT "transit_manifest_parcels_parcel_id_fkey"
    FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
