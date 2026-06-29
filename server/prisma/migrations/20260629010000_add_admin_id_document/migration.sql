-- Single identity document (with a selectable type) for admin registration.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "id_document_type" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "id_document" TEXT;
