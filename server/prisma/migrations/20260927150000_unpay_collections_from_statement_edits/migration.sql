-- Undo orders marked paid by editing a statement that was never paid.
--
-- updateSettlement used to mark every order it added as paid on the spot,
-- while the statement itself was still pending (fixed in f7305ac). The vendor
-- saw those orders as settled before any money moved, and if the statement was
-- then cancelled they stayed "paid" for good and could never be settled again.
--
-- Only rows provably caused by that are reset: paid, not on any settled
-- statement of the same leg, and either still on an open statement or added by
-- an edit (per the EDIT_SETTLEMENT audit entry) to a statement later cancelled.
-- A paid row with no statement and no such audit trail is left alone - it may
-- predate statements entirely.

UPDATE "cod_collections" c
   SET "payment_status" = 'pending', "remitted_amount" = 0
 WHERE c."payment_status" = 'paid'
   AND NOT EXISTS (
     SELECT 1 FROM "settlement_items" si JOIN "settlements" s ON s."id" = si."settlement_id"
      WHERE si."cod_collection_id" = c."id" AND s."payee_type" = 'vendor' AND s."status" = 'settled')
   AND (
     EXISTS (
       SELECT 1 FROM "settlement_items" si JOIN "settlements" s ON s."id" = si."settlement_id"
        WHERE si."cod_collection_id" = c."id" AND s."payee_type" = 'vendor'
          AND s."status" IN ('pending', 'partially_paid'))
     OR EXISTS (
       SELECT 1 FROM "audit_logs" a JOIN "settlements" s ON s."id" = a."entity_id"
        WHERE a."action" = 'EDIT_SETTLEMENT' AND s."payee_type" = 'vendor' AND s."status" = 'cancelled'
          AND a."new_data" -> 'codCollectionIds' ? c."id"::text)
   );

UPDATE "cod_collections" c
   SET "rider_payment_status" = 'pending', "rider_remitted_amount" = 0, "rider_settled_at" = NULL
 WHERE c."rider_payment_status" = 'paid'
   AND NOT EXISTS (
     SELECT 1 FROM "settlement_items" si JOIN "settlements" s ON s."id" = si."settlement_id"
      WHERE si."cod_collection_id" = c."id" AND s."payee_type" = 'rider' AND s."status" = 'settled')
   AND (
     EXISTS (
       SELECT 1 FROM "settlement_items" si JOIN "settlements" s ON s."id" = si."settlement_id"
        WHERE si."cod_collection_id" = c."id" AND s."payee_type" = 'rider'
          AND s."status" IN ('pending', 'partially_paid'))
     OR EXISTS (
       SELECT 1 FROM "audit_logs" a JOIN "settlements" s ON s."id" = a."entity_id"
        WHERE a."action" = 'EDIT_SETTLEMENT' AND s."payee_type" = 'rider' AND s."status" = 'cancelled'
          AND a."new_data" -> 'codCollectionIds' ? c."id"::text)
   );
