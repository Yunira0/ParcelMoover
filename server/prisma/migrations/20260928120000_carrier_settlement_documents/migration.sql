-- Files attached to a 3PL statement, e.g. the carrier's own settlement sheet.
CREATE TABLE "carrier_settlement_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "settlement_id" UUID NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_name" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "carrier_settlement_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_carrier_settlement_documents_settlement" ON "carrier_settlement_documents"("settlement_id", "created_at");
ALTER TABLE "carrier_settlement_documents" ADD CONSTRAINT "carrier_settlement_documents_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "carrier_settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
