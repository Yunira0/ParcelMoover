-- Ticket reply thread
CREATE TABLE IF NOT EXISTS "ticket_replies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticket_id" UUID NOT NULL,
  "author_id" UUID,
  "author_name" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ticket_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_ticket_replies_ticket_id" ON "ticket_replies" ("ticket_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_replies_ticket_id_fkey'
  ) THEN
    ALTER TABLE "ticket_replies"
      ADD CONSTRAINT "ticket_replies_ticket_id_fkey"
      FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- Per-remark workflow status (open / pending / closed), independent of order status.
ALTER TABLE "parcel_remarks" ADD COLUMN IF NOT EXISTS "workflow_status" TEXT DEFAULT 'pending';
