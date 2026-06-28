-- findOrCreateParty does findFirst({ where: { phone } }) on every order create.
-- Without an index, that's a sequential scan of the parties table.
CREATE INDEX IF NOT EXISTS idx_parties_phone ON parties (phone);
