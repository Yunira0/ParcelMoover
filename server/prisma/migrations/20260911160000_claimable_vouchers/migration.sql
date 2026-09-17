-- Retire automatic credit spending. Preserve issued grants and historic pricing.
DROP TRIGGER parcel_credit_pricing ON parcels;
DROP FUNCTION apply_parcel_credit();
DROP TRIGGER credit_settlement_snapshot ON settlement_items;
DROP FUNCTION check_credit_settlement_snapshot();

CREATE TABLE vouchers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
 title text NOT NULL, description text NOT NULL,
 discount_amount numeric(12,2) NOT NULL CHECK (discount_amount > 0),
 minimum_charge numeric(12,2) NOT NULL CHECK (minimum_charge >= 0),
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 claim_limit integer NOT NULL CHECK (claim_limit > 0),
 claimed_count integer NOT NULL DEFAULT 0 CHECK (claimed_count >= 0 AND claimed_count <= claim_limit),
 is_active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > starts_at), CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$')
);
CREATE TABLE voucher_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 voucher_id uuid NOT NULL REFERENCES vouchers(id), vendor_id uuid NOT NULL REFERENCES vendors(id),
 parcel_id uuid UNIQUE REFERENCES parcels(id),
 state text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed','reserved','used')),
 claimed_by uuid NOT NULL REFERENCES users(id), claimed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(voucher_id,vendor_id), CHECK ((state='claimed') = (parcel_id IS NULL))
);
CREATE INDEX voucher_claims_vendor_id_claimed_at_idx ON voucher_claims(vendor_id,claimed_at);
ALTER TABLE parcels ADD COLUMN voucher_claim_id uuid REFERENCES voucher_claims(id);
CREATE UNIQUE INDEX parcel_active_voucher_claim ON parcels(voucher_claim_id) WHERE voucher_claim_id IS NOT NULL;
CREATE TABLE voucher_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES voucher_claims(id),
 parcel_id uuid REFERENCES parcels(id), kind text NOT NULL CHECK(kind IN ('claim','reserve','use','release','reprice')),
 discount numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voucher_events_claim_id_created_at_idx ON voucher_events(claim_id,created_at);
CREATE TRIGGER voucher_events_immutable BEFORE UPDATE OR DELETE ON voucher_events
 FOR EACH ROW EXECUTE FUNCTION protect_promotion_history();

CREATE FUNCTION protect_voucher_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW) - 'is_active' - 'claimed_count') IS DISTINCT FROM (to_jsonb(OLD) - 'is_active' - 'claimed_count') THEN
   RAISE EXCEPTION 'Published voucher terms cannot be changed. Create a new voucher instead.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER voucher_terms_immutable BEFORE UPDATE ON vouchers FOR EACH ROW EXECUTE FUNCTION protect_voucher_terms();

CREATE FUNCTION price_order_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_row record; offer record; attaching boolean; repricing boolean; release_claim boolean;
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
   NEW.discount_amount := LEAST(offer.discount_amount,NEW.gross_delivery_charge);
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
CREATE TRIGGER order_voucher_pricing BEFORE INSERT OR UPDATE ON parcels FOR EACH ROW EXECUTE FUNCTION price_order_voucher();

CREATE FUNCTION check_voucher_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; collected numeric(12,2); payee text;
BEGIN
 SELECT parcels.* INTO p FROM parcels JOIN cod_collections c ON c.parcel_id=parcels.id
   WHERE c.id=NEW.cod_collection_id FOR UPDATE OF parcels;
 IF p.voucher_claim_id IS NOT NULL OR EXISTS (SELECT 1 FROM voucher_events WHERE parcel_id=p.id) THEN
   SELECT payee_type INTO payee FROM settlements WHERE id=NEW.settlement_id;
   SELECT collected_amount INTO collected FROM cod_collections WHERE id=NEW.cod_collection_id;
   IF payee='vendor' AND (p.deleted_at IS NOT NULL OR NEW.amount<>collected-p.delivery_charge) THEN
     RAISE EXCEPTION 'Voucher price changed; reload the settlement';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER voucher_settlement_snapshot BEFORE INSERT OR UPDATE ON settlement_items FOR EACH ROW EXECUTE FUNCTION check_voucher_settlement();
