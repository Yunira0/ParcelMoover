-- Seed the accountant role (finance-only office account) so JWT tokens can
-- carry it. Assigned from the "Accounts" department at account creation.
INSERT INTO "roles" (id, name, code, description, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Accountant', 'accountant', 'Finance and branch COD settlement', now(), now())
  ON CONFLICT (code) DO NOTHING;
