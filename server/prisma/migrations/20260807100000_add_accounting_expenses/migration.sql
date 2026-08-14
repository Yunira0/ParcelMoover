-- Expenses: the money going out that no other table records.
--
-- Everything else in the ledger is derived from an operational row that already
-- existed - a COD collection, a settlement, a vendor payment. Rent, fuel, staff
-- salaries and rider commission have no such row, so without this table the
-- books can only ever show revenue and never profit.
--
-- An expense is a thin operational record; the journal entry is the real
-- accounting artifact. This table exists so the entry has something to be
-- reviewed, searched and voided from - the entry itself is immutable.

CREATE TYPE "expense_status" AS ENUM ('recorded', 'voided');

CREATE SEQUENCE "expense_no_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

CREATE TABLE "expenses" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "expense_no"      TEXT NOT NULL,
    -- When the cost was incurred; decides the BS period, exactly as an entry's
    -- entry_date does.
    "expense_date"    TIMESTAMPTZ(6) NOT NULL,
    "bs_date"         TEXT NOT NULL,
    -- Which 5xxx account this is a cost of.
    "account_id"      UUID NOT NULL,
    -- Which pocket it came out of (cash, bank, wallet).
    "paid_from_id"    UUID NOT NULL,
    "amount"          DECIMAL(14,2) NOT NULL,
    "payee"           TEXT,
    "reference"       TEXT,
    "note"            TEXT,
    -- Optional operational attribution, for per-branch cost reporting.
    "location_id"     UUID,
    "status"          "expense_status" NOT NULL DEFAULT 'recorded',
    "created_by"      UUID,
    "voided_by"       UUID,
    "voided_at"       TIMESTAMPTZ(6),
    "void_reason"     TEXT,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    -- A zero or negative expense is not a correction, it is a mistake. Money
    -- coming back is a separate event, recorded as its own entry.
    CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0),
    -- A void must say who and when, or the trail is worthless.
    CONSTRAINT "expenses_void_complete"
        CHECK (("status" = 'recorded' AND "voided_at" IS NULL) OR ("status" = 'voided' AND "voided_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "expenses_expense_no_key" ON "expenses"("expense_no");
CREATE INDEX "idx_expenses_date" ON "expenses"("expense_date" DESC);
CREATE INDEX "idx_expenses_account" ON "expenses"("account_id", "expense_date" DESC);
CREATE INDEX "idx_expenses_status" ON "expenses"("status", "expense_date" DESC);

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_from_id_fkey"
    FOREIGN KEY ("paid_from_id") REFERENCES "ledger_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
