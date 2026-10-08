-- Shipping discounts are separate from cash/COD and vendor debt balances.
ALTER TABLE parcels ADD COLUMN gross_delivery_charge numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount numeric(12,2) NOT NULL DEFAULT 0;
UPDATE parcels SET gross_delivery_charge = delivery_charge;
ALTER TABLE parcels ADD CONSTRAINT parcel_credit_amounts CHECK
  (discount_amount >= 0 AND gross_delivery_charge >= discount_amount
   AND delivery_charge = gross_delivery_charge - discount_amount);

CREATE TABLE promotion_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 5000),
  remaining numeric(12,2) NOT NULL CHECK (remaining >= 0 AND remaining <= amount),
  kind text NOT NULL CHECK (kind IN ('onboarding','service_recovery')),
  reason text NOT NULL,
  reference text NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, kind, reference),
  CHECK (expires_at > created_at)
);
CREATE INDEX promotion_grants_vendor_id_expires_at_idx ON promotion_grants(vendor_id, expires_at);
CREATE UNIQUE INDEX promotion_onboarding_once ON promotion_grants(vendor_id) WHERE kind = 'onboarding';
CREATE TABLE promotion_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES promotion_grants(id),
  parcel_id uuid REFERENCES parcels(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('grant','redeem','reverse')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reverses_id uuid UNIQUE REFERENCES promotion_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'grant' AND parcel_id IS NULL AND reverses_id IS NULL)
    OR (kind = 'redeem' AND parcel_id IS NOT NULL AND reverses_id IS NULL)
    OR (kind = 'reverse' AND parcel_id IS NOT NULL AND reverses_id IS NOT NULL))
);
CREATE INDEX promotion_entries_grant_id_created_at_idx ON promotion_entries(grant_id, created_at);
CREATE INDEX promotion_entries_parcel_id_idx ON promotion_entries(parcel_id);

CREATE FUNCTION protect_promotion_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Parcel Credit history is immutable';
END $$;
CREATE TRIGGER promotion_history_immutable BEFORE UPDATE OR DELETE ON promotion_entries
  FOR EACH ROW EXECUTE FUNCTION protect_promotion_history();

CREATE FUNCTION protect_promotion_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Parcel Credit grants cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'remaining') IS DISTINCT FROM (to_jsonb(OLD) - 'remaining') THEN
    RAISE EXCEPTION 'Parcel Credit grant terms are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_grant_immutable BEFORE UPDATE OR DELETE ON promotion_grants
  FOR EACH ROW EXECUTE FUNCTION protect_promotion_grant();

-- A row trigger covers manual, bulk, carrier, trash/restore and reprice paths.
-- Grants are locked in expiry/id order; concurrent deliveries cannot overspend.
CREATE FUNCTION apply_parcel_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  g record; e record; take_amount numeric(12,2); needed numeric(12,2);
  eligible boolean; was_eligible boolean := false; changed boolean;
BEGIN
  eligible := NEW.vendor_id IS NOT NULL AND NEW.order_type = 'delivery'
    AND NEW.status = 'delivered' AND NEW.deleted_at IS NULL;
  IF TG_OP = 'INSERT' THEN
    NEW.gross_delivery_charge := NEW.delivery_charge;
    NEW.discount_amount := 0;
    -- New rows are not an award trigger: the real delivery transition is.
    RETURN NEW;
  END IF;
  was_eligible := OLD.vendor_id IS NOT NULL AND OLD.order_type = 'delivery'
    AND OLD.status = 'delivered' AND OLD.deleted_at IS NULL;
  changed := NEW.delivery_charge IS DISTINCT FROM OLD.delivery_charge
    OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
    OR eligible IS DISTINCT FROM was_eligible;
  IF NOT changed THEN
    NEW.gross_delivery_charge := OLD.gross_delivery_charge;
    NEW.discount_amount := OLD.discount_amount;
    RETURN NEW;
  END IF;
  -- Statements snapshot net charges: remove the parcel from a statement first.
  IF OLD.discount_amount > 0 AND EXISTS (
    SELECT 1 FROM cod_collections c JOIN settlement_items i ON i.cod_collection_id = c.id
    WHERE c.parcel_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Remove parcel from its settlement before reversing or repricing Parcel Credits';
  END IF;
  FOR e IN SELECT p.* FROM promotion_entries p
    JOIN promotion_grants grant_row ON grant_row.id = p.grant_id
    WHERE p.parcel_id = OLD.id AND p.kind = 'redeem'
      AND NOT EXISTS (SELECT 1 FROM promotion_entries r WHERE r.reverses_id = p.id)
    ORDER BY grant_row.expires_at, grant_row.id
  LOOP
    UPDATE promotion_grants SET remaining = remaining + e.amount WHERE id = e.grant_id;
    INSERT INTO promotion_entries(grant_id, parcel_id, kind, amount, reverses_id)
      VALUES (e.grant_id, OLD.id, 'reverse', e.amount, e.id);
  END LOOP;
  IF NEW.delivery_charge IS DISTINCT FROM OLD.delivery_charge THEN
    NEW.gross_delivery_charge := NEW.delivery_charge;
  ELSE
    NEW.gross_delivery_charge := OLD.gross_delivery_charge;
  END IF;
  NEW.discount_amount := 0;
  NEW.delivery_charge := NEW.gross_delivery_charge;
  IF eligible AND EXISTS (SELECT 1 FROM vendors WHERE id = NEW.vendor_id AND status = 'active' AND deleted_at IS NULL) THEN
    needed := NEW.gross_delivery_charge;
    FOR g IN SELECT * FROM promotion_grants
      WHERE vendor_id = NEW.vendor_id AND remaining > 0 AND expires_at > statement_timestamp()
      ORDER BY expires_at, id FOR UPDATE
    LOOP
      EXIT WHEN needed <= 0;
      take_amount := LEAST(g.remaining, needed);
      UPDATE promotion_grants SET remaining = remaining - take_amount WHERE id = g.id;
      INSERT INTO promotion_entries(grant_id, parcel_id, kind, amount)
        VALUES (g.id, NEW.id, 'redeem', take_amount);
      needed := needed - take_amount;
      NEW.discount_amount := NEW.discount_amount + take_amount;
    END LOOP;
    NEW.delivery_charge := NEW.gross_delivery_charge - NEW.discount_amount;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER parcel_credit_pricing BEFORE INSERT OR UPDATE ON parcels
  FOR EACH ROW EXECUTE FUNCTION apply_parcel_credit();

-- Settlement builders read amounts before inserting items. Lock the same parcel
-- and reject stale snapshots if a concurrent delivery/reversal changed its net.
CREATE FUNCTION check_credit_settlement_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; collected numeric(12,2); payee text;
BEGIN
  SELECT parcels.* INTO p FROM parcels JOIN cod_collections c ON c.parcel_id = parcels.id
    WHERE c.id = NEW.cod_collection_id FOR UPDATE OF parcels;
  IF EXISTS (SELECT 1 FROM promotion_entries WHERE parcel_id = p.id) THEN
    SELECT payee_type INTO payee FROM settlements WHERE id = NEW.settlement_id;
    SELECT collected_amount INTO collected FROM cod_collections WHERE id = NEW.cod_collection_id;
    IF payee = 'vendor' AND (p.deleted_at IS NOT NULL OR NEW.amount <> collected - p.delivery_charge) THEN
      RAISE EXCEPTION 'Parcel Credit price changed; reload the settlement and try again';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_settlement_snapshot BEFORE INSERT OR UPDATE ON settlement_items
  FOR EACH ROW EXECUTE FUNCTION check_credit_settlement_snapshot();
