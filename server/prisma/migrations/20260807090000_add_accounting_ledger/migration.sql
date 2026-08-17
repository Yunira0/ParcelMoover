-- Double-entry accounting ledger.
--
-- Layered on top of the existing operational tables, not replacing them. Money
-- events keep writing cod_collections / settlements / vendor_payments exactly
-- as before and additionally post a balanced journal entry in the SAME
-- transaction, so the books cannot drift from operations. Nothing here is
-- authoritative for order handling; it is authoritative for what the money did.
--
-- Books are kept in Bikram Sambat: a period is a BS month, a fiscal year runs
-- Shrawan -> Ashadh. Every timestamp stored is still AD timestamptz; the BS
-- strings are derived at post time (src/utils/bikramSambat.ts) and denormalized
-- only so reports can group and sort without a per-row conversion.

CREATE TYPE "ledger_account_type" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- Which side increases an account. Derivable from the type for ordinary
-- accounts, stored anyway so a contra account (natural side flipped against its
-- type) can be added later without a migration.
CREATE TYPE "ledger_normal_side" AS ENUM ('debit', 'credit');

-- A posted entry is never updated or deleted; a mistake is corrected by a
-- reversal entry, which flips the original to 'voided'.
CREATE TYPE "journal_entry_status" AS ENUM ('posted', 'voided');

CREATE TYPE "accounting_period_status" AS ENUM ('open', 'closed');

-- Subledger dimensions a line can be attributed to.
CREATE TYPE "ledger_party_type" AS ENUM ('vendor', 'rider', 'payment_method', 'location', 'user');

-- ── Chart of accounts ───────────────────────────────────────────────────────

CREATE TABLE "ledger_accounts" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "code"           TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "type"           "ledger_account_type" NOT NULL,
    "normal_side"    "ledger_normal_side" NOT NULL,
    "parent_id"      UUID,
    -- A control account is only ever posted to with a party attached, so its
    -- balance decomposes into a per-party subledger: cash held by each rider,
    -- money owed to each vendor. Enforced by the posting service and by
    -- ledger_accounts_control_has_subledger below.
    "is_control"     BOOLEAN NOT NULL DEFAULT false,
    "subledger_type" "ledger_party_type",
    "description"    TEXT,
    "is_active"      BOOLEAN NOT NULL DEFAULT true,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id"),
    -- A control account without a subledger dimension has nothing to decompose
    -- into, and a subledger dimension on a non-control account would never be
    -- enforced. Neither half is meaningful alone.
    CONSTRAINT "ledger_accounts_control_has_subledger"
        CHECK (("is_control" AND "subledger_type" IS NOT NULL) OR (NOT "is_control" AND "subledger_type" IS NULL))
);

CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "ledger_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_ledger_accounts_parent_id" ON "ledger_accounts"("parent_id");
CREATE INDEX "idx_ledger_accounts_type_code" ON "ledger_accounts"("type", "code");

-- ── Periods ─────────────────────────────────────────────────────────────────

-- One BS month of books. Closing freezes it: the posting service refuses any
-- entry landing in a closed period, so a correction to a closed month must be
-- posted into an open one - the way it works on paper.
CREATE TABLE "accounting_periods" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "period_key"  TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "bs_year"     INTEGER NOT NULL,
    "bs_month"    INTEGER NOT NULL,
    -- Half-open AD range [starts_at, ends_at). Resolved once at creation
    -- because BS month lengths vary 29-32 days and are revised year to year;
    -- pinning the boundary here keeps every later query honest.
    "starts_at"   TIMESTAMPTZ(6) NOT NULL,
    "ends_at"     TIMESTAMPTZ(6) NOT NULL,
    "status"      "accounting_period_status" NOT NULL DEFAULT 'open',
    "closed_by"   UUID,
    "closed_at"   TIMESTAMPTZ(6),
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "accounting_periods_month_range" CHECK ("bs_month" BETWEEN 1 AND 12),
    CONSTRAINT "accounting_periods_ad_range" CHECK ("ends_at" > "starts_at")
);

CREATE UNIQUE INDEX "accounting_periods_period_key_key" ON "accounting_periods"("period_key");
CREATE UNIQUE INDEX "uq_accounting_periods_bs_month" ON "accounting_periods"("bs_year", "bs_month");
CREATE INDEX "idx_accounting_periods_fiscal_year" ON "accounting_periods"("fiscal_year", "bs_month");

ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closed_by_fkey"
    FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── Journal ─────────────────────────────────────────────────────────────────

-- Voucher numbers (`JE-2083-000042`). A single global sequence rather than one
-- per fiscal year: the fiscal year is already in the prefix for readability,
-- and a global counter has no reset semantics to get wrong at year end. Gaps
-- are possible and expected - a rolled-back transaction does not give its
-- number back, which is true of every sequence-backed document number.
CREATE SEQUENCE "journal_entry_no_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

CREATE TABLE "journal_entries" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_no"       TEXT NOT NULL,
    -- The instant the economic event happened, not when it was recorded.
    "entry_date"     TIMESTAMPTZ(6) NOT NULL,
    "bs_date"        TEXT NOT NULL,
    "period_key"     TEXT NOT NULL,
    "memo"           TEXT,
    -- What produced this entry: cod_collection | settlement | vendor_payment |
    -- opening_balance | manual | reversal.
    "source_type"    TEXT NOT NULL,
    "source_id"      UUID,
    -- Distinguishes several entries sharing one source row: a delivered parcel
    -- posts both 'cod_collected' and 'delivery_charge_earned' off the same
    -- cod_collection.
    "event_key"      TEXT NOT NULL,
    "status"         "journal_entry_status" NOT NULL DEFAULT 'posted',
    "reversal_of_id" UUID,
    "posted_by"      UUID,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_entries_entry_no_key" ON "journal_entries"("entry_no");

-- The idempotency key. A retried webhook, a re-run backfill or a double-clicked
-- settlement payment must never post the same economic event twice; the posting
-- service relies on the conflict here rather than on reading first, so
-- concurrent posts of the same event collapse to one.
--
-- Postgres treats NULLs as distinct in a unique index, which is exactly what is
-- wanted: manual entries (source_id NULL) never collide with one another while
-- sourced entries stay deduplicated.
CREATE UNIQUE INDEX "uq_journal_entries_source" ON "journal_entries"("source_type", "source_id", "event_key");

CREATE INDEX "idx_journal_entries_period" ON "journal_entries"("period_key", "entry_date");
CREATE INDEX "idx_journal_entries_entry_date" ON "journal_entries"("entry_date" DESC);
CREATE INDEX "idx_journal_entries_source_lookup" ON "journal_entries"("source_type", "source_id");
CREATE INDEX "idx_journal_entries_reversal_of" ON "journal_entries"("reversal_of_id");

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_period_key_fkey"
    FOREIGN KEY ("period_key") REFERENCES "accounting_periods"("period_key") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_fkey"
    FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_fkey"
    FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "journal_lines" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_id"    UUID NOT NULL,
    "line_no"     INTEGER NOT NULL,
    "account_id"  UUID NOT NULL,
    "debit"       DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit"      DECIMAL(14,2) NOT NULL DEFAULT 0,
    -- Polymorphic subledger dimension (vendor, rider, payment method, ...), so
    -- party_id deliberately carries no FK - the same standalone pattern used by
    -- ticket_replies and vendor_staff.
    "party_type"  "ledger_party_type",
    "party_id"    UUID,
    "location_id" UUID,
    "parcel_id"   UUID,
    "memo"        TEXT,
    -- Copied from the parent entry. Safe to denormalize precisely because
    -- entries are immutable, and it keeps the ledger and subledger reports off
    -- a join-then-sort across the whole entries table.
    "entry_date"  TIMESTAMPTZ(6) NOT NULL,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_lines_amounts_non_negative" CHECK ("debit" >= 0 AND "credit" >= 0),
    -- Exactly one side carries the amount. Rules out both the ambiguous
    -- two-sided line and the zero-value filler line that would silently pass a
    -- balance check while meaning nothing.
    CONSTRAINT "journal_lines_single_sided" CHECK (("debit" = 0) <> ("credit" = 0)),
    -- A party dimension is meaningless without knowing which dimension it is.
    CONSTRAINT "journal_lines_party_complete"
        CHECK (("party_type" IS NULL AND "party_id" IS NULL) OR ("party_type" IS NOT NULL AND "party_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "uq_journal_lines_entry_line" ON "journal_lines"("entry_id", "line_no");
CREATE INDEX "idx_journal_lines_account_date" ON "journal_lines"("account_id", "entry_date" DESC);
CREATE INDEX "idx_journal_lines_party_date" ON "journal_lines"("party_type", "party_id", "entry_date" DESC);
CREATE INDEX "idx_journal_lines_entry_id" ON "journal_lines"("entry_id");
CREATE INDEX "idx_journal_lines_parcel_id" ON "journal_lines"("parcel_id");

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_parcel_id_fkey"
    FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── The balance invariant ───────────────────────────────────────────────────
--
-- sum(debit) = sum(credit) per entry, plus at least two lines. Enforced in the
-- database rather than only in the posting service, because an unbalanced entry
-- is the one corruption a ledger cannot recover from by reading harder - and
-- the service is not the only thing that will ever touch these tables (backfill
-- scripts, psql, a future import).
--
-- DEFERRABLE INITIALLY DEFERRED so an entry can legitimately be built up line
-- by line: the check runs once at COMMIT, when the entry is whole, instead of
-- rejecting the first line for not yet balancing the second.
CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
    target_entry UUID;
    line_count   INTEGER;
    debit_total  NUMERIC(14,2);
    credit_total NUMERIC(14,2);
BEGIN
    IF TG_TABLE_NAME = 'journal_entries' THEN
        target_entry := NEW."id";
    ELSIF TG_OP = 'DELETE' THEN
        target_entry := OLD."entry_id";
    ELSE
        target_entry := NEW."entry_id";
    END IF;

    -- The entry itself is gone (cascade delete of a whole entry): nothing left
    -- to balance, and complaining would block the delete.
    IF NOT EXISTS (SELECT 1 FROM "journal_entries" WHERE "id" = target_entry) THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0)
      INTO line_count, debit_total, credit_total
      FROM "journal_lines"
     WHERE "entry_id" = target_entry;

    IF line_count < 2 THEN
        RAISE EXCEPTION 'Journal entry % has % line(s); a double-entry posting needs at least 2',
            target_entry, line_count;
    END IF;

    IF debit_total <> credit_total THEN
        RAISE EXCEPTION 'Journal entry % is unbalanced: debits %, credits %',
            target_entry, debit_total, credit_total;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
    AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

-- Catches the entry inserted with no lines at all, which the line-level trigger
-- above can never fire for.
CREATE CONSTRAINT TRIGGER "journal_entries_balanced"
    AFTER INSERT ON "journal_entries"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

-- ── Immutability ────────────────────────────────────────────────────────────
--
-- A posted entry's money may not be edited or deleted; corrections go through a
-- reversal entry. Only `status` may change (posted -> voided, set by the
-- reversal), so the trail of what was believed and when survives intact.
CREATE OR REPLACE FUNCTION assert_journal_entry_immutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Journal entry % cannot be deleted; post a reversal instead', OLD."id";
    END IF;

    IF NEW."entry_date"  IS DISTINCT FROM OLD."entry_date"
    OR NEW."period_key"  IS DISTINCT FROM OLD."period_key"
    OR NEW."bs_date"     IS DISTINCT FROM OLD."bs_date"
    OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
    OR NEW."source_id"   IS DISTINCT FROM OLD."source_id"
    OR NEW."event_key"   IS DISTINCT FROM OLD."event_key"
    OR NEW."entry_no"    IS DISTINCT FROM OLD."entry_no" THEN
        RAISE EXCEPTION 'Journal entry % is immutable; only status may change', OLD."id";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entries_immutable"
    BEFORE UPDATE OR DELETE ON "journal_entries"
    FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_immutable();

-- Lines are write-once. They are only ever inserted as part of building an
-- entry; nothing in the system has a reason to rewrite one afterwards.
CREATE OR REPLACE FUNCTION assert_journal_line_immutable() RETURNS trigger AS $$
BEGIN
    -- Deleting the parent entry is already blocked above, so a cascade can
    -- never reach here; a direct line delete is what this stops. OLD is the
    -- populated record for both UPDATE and DELETE, so it is the only one safe
    -- to read here.
    RAISE EXCEPTION 'Journal line % is immutable; post a reversal entry instead', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_lines_immutable"
    BEFORE UPDATE OR DELETE ON "journal_lines"
    FOR EACH ROW EXECUTE FUNCTION assert_journal_line_immutable();
