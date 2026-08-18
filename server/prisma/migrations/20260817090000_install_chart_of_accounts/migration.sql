-- Install the chart of accounts.
--
-- Until now these rows came only from `npm run seed:accounting`, which nothing
-- runs on deploy - the runtime image has no ts-node and the seed is not
-- compiled into dist/. So a deployed environment got the accounting *tables*
-- and none of the accounts, and Finance answered "Account 1000 not found" on
-- first load. The chart is structural, not sample data, so it belongs with the
-- schema rather than beside it.
--
-- ON CONFLICT DO NOTHING throughout: an account that already exists is left
-- exactly as it is. Nothing here may change an existing row's type or
-- normal_side, because journal_lines already reference it and flipping a
-- normal side would reinterpret every entry ever posted to that account.
-- seed-accounting.ts remains the place to refresh names and descriptions.
--
-- 1020 / 1030 / 1090 are deliberately absent: 20260813100000_flatten_cash_accounts
-- retired those family accounts, and each payment method now owns an account
-- generated at runtime.

INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_side", "is_control", "subledger_type", "description")
VALUES
  -- ── Assets ────────────────────────────────────────────────────────────────
  ('1000', 'Cash in Hand', 'asset', 'debit', false, NULL,
   'Physical cash held at an office or branch, after riders remit it.'),
  ('1010', 'Cash with Rider', 'asset', 'debit', true, 'rider',
   'COD a rider has collected but not yet remitted. Still ours, just not in our hands - the per-rider balance is the cash that rider owes the office right now.'),

  -- ── Liabilities ───────────────────────────────────────────────────────────
  ('2000', 'Vendor', 'liability', 'credit', true, 'vendor',
   'Net position with each vendor. Credited with COD collected on their behalf and payments they send us, debited with delivery charges earned and payouts made. A credit balance is money we owe them; a debit balance is money they owe us.'),

  -- ── Equity ────────────────────────────────────────────────────────────────
  ('3000', 'Opening Balance Equity', 'equity', 'credit', false, NULL,
   'Counterweight for balances that predate the ledger and cannot be reconstructed from source rows. Should be closed to retained earnings once the opening position is agreed.'),
  ('3900', 'Retained Earnings', 'equity', 'credit', false, NULL,
   'Accumulated profit carried forward from closed fiscal years.'),

  -- ── Revenue ───────────────────────────────────────────────────────────────
  ('4000', 'Delivery Charge Revenue', 'revenue', 'credit', false, NULL,
   'Delivery charges earned on delivered and partially delivered parcels.'),
  ('4010', 'Redirect Charge Revenue', 'revenue', 'credit', false, NULL,
   'Charges for redirecting a parcel after booking. Not yet posted to: parcel_redirects folds its charge into parcels.delivery_charge, so the two are indistinguishable in the data until order.service separates them.'),
  ('4020', 'Return Charge Revenue', 'revenue', 'credit', false, NULL,
   'Charges earned on return orders, priced at the vendor''s return percentage.'),

  -- ── Expenses ──────────────────────────────────────────────────────────────
  ('5000', 'Rider Commission & Incentives', 'expense', 'debit', false, NULL,
   'Per-delivery commission and incentives paid to riders.'),
  ('5100', 'Fuel & Vehicle', 'expense', 'debit', false, NULL,
   'Fuel, servicing and vehicle running costs.'),
  ('5110', 'Vehicle Maintenance & Repairs', 'expense', 'debit', false, NULL,
   'Servicing, repairs, tyres and parts. Kept apart from fuel because one is a running cost that tracks distance and the other is lumpy and per-bike - averaging them together hides which bike is expensive.'),
  ('5200', 'Office & Branch Rent', 'expense', 'debit', false, NULL,
   'Rent for offices, hubs and branches.'),
  ('5210', 'Office Expenses & Utilities', 'expense', 'debit', false, NULL,
   'Electricity, internet, stationery, packaging, tea - the day-to-day cost of keeping an office open.'),
  ('5300', 'Salaries & Wages', 'expense', 'debit', false, NULL,
   'Staff payroll, excluding rider commission.'),
  ('5900', 'COD Loss & Write-off', 'expense', 'debit', false, NULL,
   'COD that will not be recovered - lost, damaged or written-off parcels.')
ON CONFLICT ("code") DO NOTHING;
