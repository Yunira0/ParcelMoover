-- Branch COD statements start posting to the ledger (describeBranchSettlement).
--
-- 1015 holds what each branch has put on a statement but not yet paid head
-- office, so it is a control account with a per-location subledger. 5010 is the
-- commission a branch keeps out of that COD.
--
-- ON CONFLICT DO NOTHING, as with the rest of the chart: an existing row is
-- never reshaped, because journal lines may already reference it.
INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_side", "is_control", "subledger_type", "sub_type", "description")
VALUES
  ('1015', 'COD with Branch', 'asset', 'debit', true, 'location', 'current_asset',
   'COD a branch has put on a statement to head office but not yet paid. Debited when the statement is raised, cleared as its instalments land - the per-branch balance is what that branch owes head office right now.'),
  ('5010', 'Branch Commission', 'expense', 'debit', false, NULL, 'indirect_expense',
   'Per-parcel commission a branch keeps out of the COD it remits to head office.')
ON CONFLICT ("code") DO NOTHING;
