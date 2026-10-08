-- Daraz-style vouchers: fixed Rs off plus percentage-off with an optional cap.
-- Existing offers are all fixed-amount, so they backfill cleanly as discount_type='fixed'.
-- Percent offers store discount_amount as 0, so the original
-- discount_amount > 0 check has to go — voucher_discount_shape below takes
-- over the per-type validation.
ALTER TABLE vouchers DROP CONSTRAINT vouchers_discount_amount_check;
ALTER TABLE vouchers ADD COLUMN discount_type text NOT NULL DEFAULT 'fixed'
  CHECK (discount_type IN ('fixed', 'percent'));
ALTER TABLE vouchers ADD COLUMN discount_percent numeric(5,2)
  CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100));
ALTER TABLE vouchers ADD COLUMN max_discount numeric(12,2)
  CHECK (max_discount IS NULL OR max_discount > 0);
-- For percent offers discount_amount is unused (kept 0 so the NOT NULL column stays meaningful).
ALTER TABLE vouchers ADD CONSTRAINT voucher_discount_shape CHECK (
  (discount_type = 'fixed' AND discount_percent IS NULL AND discount_amount > 0)
  OR (discount_type = 'percent' AND discount_percent IS NOT NULL)
);
ALTER TABLE vouchers ALTER COLUMN discount_type DROP DEFAULT;

CREATE OR REPLACE FUNCTION price_order_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_row record; offer record; attaching boolean; repricing boolean; release_claim boolean; offer_discount numeric(12,2);
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.voucher_claim_id IS NOT NULL THEN RAISE EXCEPTION 'Attach a voucher after creating the parcel'; END IF;
    NEW.gross_delivery_charge := NEW.delivery_charge; NEW.discount_amount := 0;
    RETURN NEW;
  END IF;
  attaching := OLD.voucher_claim_id IS NULL AND NEW.voucher_claim_id IS NOT NULL;
  repricing := NEW.delivery_charge IS DISTINCT FROM OLD.delivery_charge;
  IF OLD.voucher_claim_id IS NOT NULL AND NEW.voucher_claim_id IS DISTINCT FROM OLD.voucher_claim_id THEN
    RAISE EXCEPTION 'An order voucher cannot be replaced';
  END IF;
  IF NEW.voucher_claim_id IS NULL THEN
    -- Historical credit discounts remain as recorded; no new credits are spent.
    NEW.gross_delivery_charge := CASE WHEN repricing THEN NEW.delivery_charge ELSE OLD.gross_delivery_charge END;
    NEW.discount_amount := CASE WHEN repricing THEN 0 ELSE OLD.discount_amount END;
    RETURN NEW;
  END IF;
  SELECT * INTO claim_row FROM voucher_claims WHERE id=NEW.voucher_claim_id FOR UPDATE;
  SELECT * INTO offer FROM vouchers WHERE id=claim_row.voucher_id;
  IF claim_row.vendor_id IS DISTINCT FROM NEW.vendor_id THEN RAISE EXCEPTION 'Voucher belongs to another vendor'; END IF;
  IF NEW.order_type <> 'delivery' THEN RAISE EXCEPTION 'Vouchers apply to outbound delivery orders only'; END IF;
  IF attaching THEN
    IF NEW.status <> 'pickup_ordered' OR NEW.deleted_at IS NOT NULL OR claim_row.state <> 'claimed'
      OR NOT offer.is_active OR offer.starts_at > statement_timestamp() OR offer.expires_at <= statement_timestamp() THEN
      RAISE EXCEPTION 'Voucher is unavailable, expired or already used';
    END IF;
    IF NEW.gross_delivery_charge < offer.minimum_charge THEN RAISE EXCEPTION 'Minimum delivery charge not met'; END IF;
    UPDATE voucher_claims SET state='reserved',parcel_id=NEW.id WHERE id=claim_row.id;
  ELSIF claim_row.parcel_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Voucher reservation does not match this order';
  END IF;
  release_claim := NEW.status='cancelled' OR NEW.deleted_at IS NOT NULL;
  IF (repricing OR release_claim OR NEW.status='returned_to_vendor') AND OLD.discount_amount>0 AND EXISTS (
    SELECT 1 FROM cod_collections c JOIN settlement_items i ON i.cod_collection_id=c.id WHERE c.parcel_id=OLD.id
  ) THEN RAISE EXCEPTION 'Remove the order from its settlement before changing its voucher price'; END IF;
  NEW.gross_delivery_charge := CASE WHEN repricing THEN NEW.delivery_charge ELSE OLD.gross_delivery_charge END;
  IF release_claim THEN
    UPDATE voucher_claims SET state='claimed',parcel_id=NULL WHERE id=claim_row.id;
    INSERT INTO voucher_events(claim_id,parcel_id,kind,discount) VALUES(claim_row.id,NEW.id,'release',OLD.discount_amount);
    NEW.voucher_claim_id := NULL; NEW.discount_amount := 0;
  ELSIF NEW.status='returned_to_vendor' THEN
    UPDATE voucher_claims SET state='used' WHERE id=claim_row.id;
    NEW.discount_amount := 0;
  ELSE
    IF NEW.gross_delivery_charge < offer.minimum_charge THEN RAISE EXCEPTION 'Repriced delivery charge no longer meets voucher minimum; cancel and recreate the order'; END IF;
    offer_discount := CASE WHEN offer.discount_type = 'percent'
      THEN LEAST(NEW.gross_delivery_charge * offer.discount_percent / 100,
                 COALESCE(offer.max_discount, NEW.gross_delivery_charge))
      ELSE offer.discount_amount END;
    NEW.discount_amount := LEAST(offer_discount, NEW.gross_delivery_charge);
    IF NEW.status IN ('delivered','partially_delivered') AND claim_row.state <> 'used' THEN
      UPDATE voucher_claims SET state='used' WHERE id=claim_row.id;
      INSERT INTO voucher_events(claim_id,parcel_id,kind,discount) VALUES(claim_row.id,NEW.id,'use',NEW.discount_amount);
    END IF;
  END IF;
  NEW.delivery_charge := NEW.gross_delivery_charge-NEW.discount_amount;
  IF attaching OR (repricing AND NOT release_claim) THEN
    INSERT INTO voucher_events(claim_id,parcel_id,kind,discount)
      VALUES(claim_row.id,NEW.id,CASE WHEN attaching THEN 'reserve' ELSE 'reprice' END,NEW.discount_amount);
  END IF;
  RETURN NEW;
END $$;
