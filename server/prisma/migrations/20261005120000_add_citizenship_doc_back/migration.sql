-- Admin and rider registration now take both sides of the citizenship
-- document, like vendors already do. citizenship_doc keeps holding the front.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "citizenship_doc_back" TEXT;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "citizenship_doc_back" TEXT;
