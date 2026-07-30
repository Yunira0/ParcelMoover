-- Vendor credit control.
--
-- A vendor's account balance is derived, not stored: lifetime COD collected on
-- their behalf, minus delivery charges earned on their parcels, minus payouts
-- already settled to them, plus payments they have made back to the office.
-- Negative means the vendor owes us - which is the normal state for a vendor
-- shipping zero-COD parcels, since every such parcel is a pure delivery charge.
--
-- Nothing here stores the balance itself; these tables hold the two inputs that
-- had no home before (inbound payments, thresholds) plus the alert bookkeeping
-- that stops a threshold notification firing on every single delivery.

-- Which side of the thresholds a vendor was on at the last evaluation. Stored
-- so a crossing notifies once, instead of once per parcel delivered.
CREATE TYPE "vendor_billing_state" AS ENUM ('ok', 'warned', 'blocked');

-- A vendor-submitted payment starts as a claim. It must never credit the
-- balance before an admin verifies it, or a blocked vendor could unblock
-- themselves simply by claiming a payment they never made.
CREATE TYPE "vendor_payment_status" AS ENUM ('pending', 'verified', 'rejected');

-- Vendor -> office payments, settling delivery charges owed. The opposite
-- direction from `settlements`, which only ever models office -> vendor payouts
-- and cannot carry a negative payable.
CREATE TABLE "vendor_payments" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id"     UUID NOT NULL,
    "amount"        DECIMAL(12,2) NOT NULL,
    "method"        TEXT NOT NULL DEFAULT 'fonepay',
    -- Transaction id from the payment app, for reconciliation against the
    -- merchant statement.
    "reference"     TEXT,
    -- Encrypted at rest like every other upload (see documentEncryption.ts).
    "proof_path"    TEXT,
    "status"        "vendor_payment_status" NOT NULL DEFAULT 'pending',
    "note"          TEXT,
    "submitted_by"  UUID,
    "reviewed_by"   UUID,
    "reviewed_at"   TIMESTAMPTZ(6),
    "review_remark" TEXT,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_payments_amount_positive" CHECK ("amount" > 0)
);

ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_submitted_by_fkey"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The balance sums verified rows per vendor; the review queue lists pending
-- ones newest-first.
CREATE INDEX "idx_vendor_payments_vendor_status" ON "vendor_payments"("vendor_id", "status");
CREATE INDEX "idx_vendor_payments_status_created" ON "vendor_payments"("status", "created_at" DESC);

-- Singleton configuration row, mirroring pricing_settings. Thresholds are
-- stored as the (negative) balance they trip at, so they read the same way
-- they are discussed: warn at -2000, block at -3000.
CREATE TABLE "billing_settings" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "warn_threshold"  DECIMAL(12,2) NOT NULL DEFAULT -2000,
    "block_threshold" DECIMAL(12,2) NOT NULL DEFAULT -3000,
    -- Static Fonepay QR shown to vendors in the pay-now flow.
    "payment_qr_path" TEXT,
    "payment_note"    TEXT,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- Per-vendor threshold overrides (NULL falls back to billing_settings, the same
-- way the vendors.flat_* rate columns fall back to pricing_settings), plus the
-- alert state machine.
ALTER TABLE "vendors" ADD COLUMN "billing_warn_threshold"  DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN "billing_block_threshold" DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN "billing_alert_state" "vendor_billing_state" NOT NULL DEFAULT 'ok';
ALTER TABLE "vendors" ADD COLUMN "billing_alert_at" TIMESTAMPTZ(6);

-- The balance sums delivery charges over a vendor's earned parcels; without
-- this the aggregate degrades to a scan as the parcels table grows.
CREATE INDEX "idx_parcels_vendor_status_charge" ON "parcels"("vendor_id", "status") WHERE "deleted_at" IS NULL;
