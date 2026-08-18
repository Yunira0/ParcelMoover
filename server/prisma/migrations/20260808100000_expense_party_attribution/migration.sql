-- Attribute an expense to whoever it was spent on.
--
-- Until now the ledger could answer "what does this rider owe us" (their COD
-- control account) but not "what has this rider cost us" - fuel, salary and
-- maintenance were recorded against a category with a free-text payee and
-- nothing tying them to the person. So the two halves of a rider's money story
-- lived in different places and neither could be searched by name.
--
-- With a party on the expense, its journal line carries that party too, and one
-- query over journal_lines returns everything the company has ever paid to or
-- collected from anyone - regardless of which account it landed in.
--
-- Reusing ledger_party_type keeps this the same dimension the control accounts
-- already use, so a rider's COD and a rider's fuel are the same "rider" to every
-- query that reads it.

ALTER TABLE "expenses" ADD COLUMN "party_type" "ledger_party_type";
ALTER TABLE "expenses" ADD COLUMN "party_id"   UUID;

-- Half a party dimension is not usable: a name with no idea what kind of thing
-- it names cannot be joined to anything.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_party_complete"
    CHECK (("party_type" IS NULL AND "party_id" IS NULL) OR ("party_type" IS NOT NULL AND "party_id" IS NOT NULL));

-- The "everything for this person" lookup, which is the whole point.
CREATE INDEX "idx_expenses_party" ON "expenses"("party_type", "party_id", "expense_date" DESC);
