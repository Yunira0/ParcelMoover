-- Sales person assigned to a vendor (free text or chosen from existing sales staff).
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "sales" TEXT;
