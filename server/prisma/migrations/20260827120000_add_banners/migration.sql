-- Vendor-facing notice banners (modal popup or permanent dashboard strip).
-- See schema.prisma's `banners` model comment for the full design note.

CREATE TYPE "banner_display_type" AS ENUM ('modal', 'permanent');

CREATE TABLE "banners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "image_path" TEXT NOT NULL,
    "link_url" TEXT,
    "display_type" "banner_display_type" NOT NULL DEFAULT 'permanent',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_banners_display_enabled" ON "banners"("display_type", "is_enabled");

ALTER TABLE "banners" ADD CONSTRAINT "banners_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
