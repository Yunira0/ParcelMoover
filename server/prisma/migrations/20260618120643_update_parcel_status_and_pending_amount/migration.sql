DROP TYPE IF EXISTS "parcel_status_new";

CREATE TYPE "parcel_status_new" AS ENUM (
  'pickup_ordered', 'rider_assigned', 'picked_up', 'arrived',
  'ready_to_deliver', 'sent_for_delivery', 'oov', 'dispatched',
  'arrived_at_branch', 'hold', 'loss_and_damage', 'delivered',
  'failed_pickup', 'failed_delivery', 'cancelled'
);

ALTER TABLE "parcel_exceptions" ALTER COLUMN "previous_status" TYPE "parcel_status_new" USING (
  CASE "previous_status"::text
    WHEN 'failed' THEN 'failed_delivery'
    ELSE "previous_status"::text
  END
)::"parcel_status_new";

ALTER TABLE "parcel_status_history" ALTER COLUMN "old_status" TYPE "parcel_status_new" USING (
  CASE "old_status"::text
    WHEN 'failed' THEN 'failed_delivery'
    ELSE "old_status"::text
  END
)::"parcel_status_new";

ALTER TABLE "parcel_status_history" ALTER COLUMN "new_status" TYPE "parcel_status_new" USING (
  CASE "new_status"::text
    WHEN 'failed' THEN 'failed_delivery'
    ELSE "new_status"::text
  END
)::"parcel_status_new";

ALTER TABLE "parcels" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "parcels" ALTER COLUMN "status" TYPE "parcel_status_new" USING (
  CASE "status"::text
    WHEN 'failed' THEN 'failed_delivery'
    ELSE "status"::text
  END
)::"parcel_status_new";
ALTER TABLE "parcels" ALTER COLUMN "status" SET DEFAULT 'pickup_ordered';

ALTER TABLE "pickup_tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "pickup_tasks" ALTER COLUMN "status" TYPE "parcel_status_new" USING (
  CASE "status"::text
    WHEN 'failed' THEN 'failed_delivery'
    ELSE "status"::text
  END
)::"parcel_status_new";
ALTER TABLE "pickup_tasks" ALTER COLUMN "status" SET DEFAULT 'pickup_ordered';

DROP TYPE "parcel_status";
ALTER TYPE "parcel_status_new" RENAME TO "parcel_status";
