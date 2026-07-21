-- Configurable settlement payment methods (Cash, Online, eSewa, Bank, ...).
CREATE TABLE IF NOT EXISTS "payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_name_key" ON "payment_methods"("name");

-- Seed the two methods that existed as a hardcoded enum before this table.
INSERT INTO "payment_methods" ("name", "sort_order")
VALUES ('Cash', 0), ('Online', 1)
ON CONFLICT ("name") DO NOTHING;
