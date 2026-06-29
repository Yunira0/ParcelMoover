-- Document number for the selected admin identity document.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "id_document_number" TEXT;
