-- Settlements become the only money event in the books.
--
-- Until now the ledger posted twice per parcel: COD collected when a rider took
-- the cash, and the delivery charge when the parcel was delivered. That made
-- the journal a copy of the parcel table - tens of thousands of entries nobody
-- could read - and it put the same money rule in two places, where it drifted.
--
-- From here nothing posts per parcel. A statement carries the whole cycle in
-- one entry: COD comes off the float the rider remittances built up, the
-- office's cut becomes revenue, and the remainder goes out to the vendor. What
-- a vendor is owed *before* their statement is written stays where it always
-- really lived - cod_collections and parcels.delivery_charge, via
-- billing.service - and is not a journal entry at all.
--
-- Two things follow, and both are in this file:
--   1. A new account to hold COD between the two legs.
--   2. Reversal of every per-parcel entry already posted.

-- ── 1. Where COD sits between the rider and the vendor ──────────────────────
--
-- 1010 Cash with Rider used to hold it, credited per parcel and cleared on
-- remittance. With no per-parcel posting there is nothing to debit it with, so
-- the float moves to a liability that reads as what it is: cash in our hands
-- that is not ours.
--
-- Deliberately not a control account. A rider hands over one pooled sum that no
-- single vendor can be named against, so a per-vendor subledger here would be a
-- balance that never balances.
INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_side", "is_control", "subledger_type", "description")
VALUES
  ('2005', 'COD Held for Vendors', 'liability', 'credit', false, NULL,
   'COD taken in from riders but not yet passed on to vendors. Credited when a rider settles their collections to the office, debited when a vendor statement hands that money on. The balance is the float the office is sitting on: cash in our hands that is not ours.')
ON CONFLICT ("code") DO NOTHING;

-- 2000's description no longer describes what it does. Day-to-day COD and
-- delivery charges stopped passing through it; direct vendor payments are all
-- that is left. Type and normal_side are untouched - flipping either would
-- reinterpret every entry ever posted to it.
UPDATE "ledger_accounts"
SET "description" = 'Direct position with each vendor, outside the COD cycle: credited with payments they send the office. A credit balance is money we owe them; a debit balance is money they owe us. Day-to-day COD and delivery charges do not pass through here - they are recognised on the statement that settles them, against COD Held for Vendors.'
WHERE "code" = '2000';

-- ── 2. Reverse every per-parcel entry ───────────────────────────────────────
--
-- Not deleted: journal_entries and journal_lines are immutable by trigger, and
-- that is the point of them. Every cod_collected / delivery_charge_earned entry
-- gets a mirror-image entry that cancels it, and the original is marked voided
-- and linked to its reversal - the same shape reverseJournal produces, because
-- corrections in this ledger are reversals and nothing else.
--
-- Reports include voided entries deliberately (see accounting.service.ts): an
-- entry and its reversal net to zero, so counting both is correct and counting
-- only the reversal would double the error.
--
-- Idempotent: an entry already voided is skipped, so re-running changes nothing.

-- The reversal entries themselves. entry_no is generated from the same sequence
-- the application uses, so numbering stays continuous.
WITH to_reverse AS (
  SELECT e.*
  FROM "journal_entries" e
  WHERE e."event_key" IN ('cod_collected', 'delivery_charge_earned')
    AND e."status" = 'posted'
), inserted AS (
  INSERT INTO "journal_entries"
    ("entry_no", "entry_date", "bs_date", "period_key", "source_type", "source_id",
     "event_key", "memo", "status", "reversal_of_id", "posted_by")
  SELECT
    'JE-' || split_part(r."entry_no", '-', 2) || '-' ||
      lpad(nextval('journal_entry_no_seq')::text, 6, '0'),
    r."entry_date", r."bs_date", r."period_key", r."source_type", r."source_id",
    -- The idempotency key is (source_type, source_id, event_key), so the
    -- reversal cannot reuse the original's or it would collide with it.
    r."event_key" || '#reversal',
    'Reversal: parcel-level postings retired (settlements are now the only money event)',
    'posted', r."id", NULL
  FROM to_reverse r
  RETURNING "id", "reversal_of_id"
)
INSERT INTO "journal_lines"
  ("entry_id", "line_no", "account_id", "debit", "credit",
   "party_type", "party_id", "location_id", "parcel_id", "memo", "entry_date")
SELECT
  i."id", l."line_no", l."account_id",
  -- The mirror image: every debit becomes a credit and back again.
  l."credit", l."debit",
  l."party_type", l."party_id", l."location_id", l."parcel_id",
  'Reversal of ' || COALESCE(l."memo", 'parcel posting'), l."entry_date"
FROM inserted i
JOIN "journal_entries" o ON o."id" = i."reversal_of_id"
JOIN "journal_lines" l ON l."entry_id" = o."id";

-- Mark the originals voided. `status` is the one column the immutability
-- trigger allows to change, which is exactly what it was left open for.
UPDATE "journal_entries"
SET "status" = 'voided'
WHERE "event_key" IN ('cod_collected', 'delivery_charge_earned')
  AND "status" = 'posted';
