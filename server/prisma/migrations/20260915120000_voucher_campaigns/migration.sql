-- Bulk voucher campaigns (e.g. Dashain 20% off): a campaign holds shared terms
-- plus a batch of unique single-claim codes for printed slips. Campaign rows
-- carry status only; per-code vouchers rows carry the immutable terms, so the
-- existing protect_voucher_terms trigger keeps working untouched (campaign_id
-- and is_listed are set once at generation and never updated afterwards).
CREATE TABLE voucher_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 60),
 code_prefix text NOT NULL CHECK (code_prefix ~ '^[A-Z0-9]{2,10}$'),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
 discount_type text NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed','percent')),
 discount_amount numeric(12,2) NOT NULL CHECK (discount_amount >= 0),
 discount_percent numeric(5,2) CHECK (discount_percent IS NULL OR (discount_percent >= 0.01 AND discount_percent <= 100)),
 max_discount numeric(12,2) CHECK (max_discount IS NULL OR max_discount > 0),
 minimum_charge numeric(12,2) NOT NULL CHECK (minimum_charge >= 0),
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 max_per_vendor integer NOT NULL DEFAULT 1 CHECK (max_per_vendor >= 1),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > starts_at)
);
ALTER TABLE vouchers ADD COLUMN campaign_id uuid REFERENCES voucher_campaigns(id);
ALTER TABLE vouchers ADD COLUMN is_listed boolean NOT NULL DEFAULT true;
CREATE INDEX vouchers_campaign_id_idx ON vouchers(campaign_id);
