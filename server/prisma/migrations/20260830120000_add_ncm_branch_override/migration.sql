-- Add explicit NCM branch override for locations (fixes Jhiljhile->Hile/Bahundangi misroutes)
ALTER TABLE "locations" ADD COLUMN "ncm_branch" TEXT;
