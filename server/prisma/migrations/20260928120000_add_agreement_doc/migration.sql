-- Signed agreement (PDF or DOCX) that staff attach to an admin, vendor or
-- rider from the edit form. Nullable: existing accounts simply have none yet.
ALTER TABLE "admins" ADD COLUMN "agreement_doc" TEXT;
ALTER TABLE "vendors" ADD COLUMN "agreement_doc" TEXT;
ALTER TABLE "riders" ADD COLUMN "agreement_doc" TEXT;
