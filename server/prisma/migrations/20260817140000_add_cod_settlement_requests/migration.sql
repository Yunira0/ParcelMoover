-- A vendor's request to be paid out the COD we are holding for them.
--
-- Previously raised as a support ticket with category "cod_settlement". That
-- had two problems this table exists to fix: a vendor could open unlimited
-- simultaneous requests for the same money, and their payout bank details were
-- flattened into the ticket's free-text description instead of being columns
-- anyone could query or validate.
--
-- Existing cod_settlement tickets are deliberately left alone. They stay
-- readable in the ticket history; only the route for raising new ones moves.

CREATE TYPE "cod_settlement_request_status" AS ENUM ('open', 'in_progress', 'settled', 'rejected');

CREATE TABLE "cod_settlement_requests" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_no"      TEXT NOT NULL,
    "vendor_id"       UUID NOT NULL,
    -- Captured per request rather than read off the vendor record: a payout
    -- account can differ from the one registered at KYC, and what matters is
    -- the account they nominated on the day.
    "bank_name"       TEXT NOT NULL,
    "account_number"  TEXT NOT NULL,
    "account_name"    TEXT NOT NULL,
    "note"            TEXT,
    -- The vendor's unsettled COD at the moment of asking. Context for the
    -- admin, not an authority: the real payable is recomputed at settlement
    -- time and will have moved on by then.
    "amount_snapshot" DECIMAL(12,2),
    "status"          "cod_settlement_request_status" NOT NULL DEFAULT 'open',
    -- Set once an admin settles the request against a real payout.
    "settlement_id"   UUID,
    "decision_note"   TEXT,
    "created_by"      UUID,
    "reviewed_by"     UUID,
    "reviewed_at"     TIMESTAMPTZ(6),
    "closed_at"       TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "cod_settlement_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cod_settlement_requests_request_no_key"
    ON "cod_settlement_requests"("request_no");

CREATE INDEX "idx_cod_settlement_requests_vendor"
    ON "cod_settlement_requests"("vendor_id", "created_at" DESC);

CREATE INDEX "idx_cod_settlement_requests_status"
    ON "cod_settlement_requests"("status", "created_at" DESC);

-- The actual enforcement of "one live request per vendor".
--
-- The service checks this too, for a readable error message, but a check-then-
-- insert in application code races: two submissions landing together both see
-- no open request and both insert. Only the database can decide that. 'settled'
-- and 'rejected' are excluded so a closed request releases the hold - and
-- rejection must release it, or one refused request would lock a vendor out of
-- ever asking again.
CREATE UNIQUE INDEX "cod_settlement_requests_one_live_per_vendor"
    ON "cod_settlement_requests"("vendor_id")
    WHERE "status" IN ('open', 'in_progress');

ALTER TABLE "cod_settlement_requests" ADD CONSTRAINT "cod_settlement_requests_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "cod_settlement_requests" ADD CONSTRAINT "cod_settlement_requests_settlement_id_fkey"
    FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "cod_settlement_requests" ADD CONSTRAINT "cod_settlement_requests_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "cod_settlement_requests" ADD CONSTRAINT "cod_settlement_requests_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
