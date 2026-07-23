-- Pickup windows vendors can choose from when raising a "pickup" support
-- ticket. start_minutes/end_minutes are minutes-since-midnight; the booking
-- cutoff (1hr before end) is derived in application code, not stored.
CREATE TABLE IF NOT EXISTS "pickup_time_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "pickup_time_slots_pkey" PRIMARY KEY ("id")
);

-- Seed with the previously-hardcoded slots: 9-12, 2-5, 5-8.
INSERT INTO "pickup_time_slots" ("start_minutes", "end_minutes", "sort_order") VALUES
    (540, 720, 0),
    (840, 1020, 1),
    (1020, 1200, 2);
