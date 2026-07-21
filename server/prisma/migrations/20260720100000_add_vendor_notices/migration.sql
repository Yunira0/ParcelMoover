-- Admin-managed popup notices for vendors.
CREATE TABLE IF NOT EXISTS "vendor_notices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_dismissable" BOOLEAN NOT NULL DEFAULT true,
    "target" TEXT NOT NULL DEFAULT 'all',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "vendor_notices_pkey" PRIMARY KEY ("id")
);

-- Maps specific vendors when target = "specific".
CREATE TABLE IF NOT EXISTS "vendor_notice_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notice_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    CONSTRAINT "vendor_notice_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_notice_targets_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "vendor_notices"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "vendor_notice_targets_notice_id_vendor_id_key" UNIQUE ("notice_id", "vendor_id")
);

CREATE INDEX IF NOT EXISTS "idx_vendor_notice_targets_vendor_id" ON "vendor_notice_targets"("vendor_id");

-- Tracks which vendors dismissed a notice.
CREATE TABLE IF NOT EXISTS "vendor_notice_dismissals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notice_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "dismissed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "vendor_notice_dismissals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_notice_dismissals_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "vendor_notices"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "vendor_notice_dismissals_notice_id_vendor_id_key" UNIQUE ("notice_id", "vendor_id")
);

CREATE INDEX IF NOT EXISTS "idx_vendor_notice_dismissals_vendor_id" ON "vendor_notice_dismissals"("vendor_id");
