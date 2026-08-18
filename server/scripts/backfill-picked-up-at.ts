// One-off backfill: parcels.picked_up_at was only stamped once the status
// transition code started doing it, and even then only when the transition
// target was exactly "picked_up". A super_admin may force any transition from
// any status, so parcels that were jumped straight from pickup_ordered to
// delivered never got a timestamp either. The dashboard's "Picked Up" trend
// counts parcels by picked_up_at per day, so every one of those is missing
// from the chart permanently.
//
// parcel_status_history records the real transition, so where a "picked_up"
// row exists the exact time is recoverable - this uses the earliest such row
// (a parcel can be forced back and re-picked-up; the first one is when the
// goods actually left the sender). Parcels with no pickup row anywhere are
// left alone rather than guessed at: mostly seed data inserted directly at a
// late status, and inventing a date would put fictional bars on the chart.
// Going forward pickupStampFor in order.service.ts closes the skip path, so
// this only has to catch the backlog.
//
// Safe to re-run: only touches rows where picked_up_at IS NULL, so once
// backfilled the where-clause matches zero rows.
//
// Usage:
//   ts-node --transpile-only scripts/backfill-picked-up-at.ts [--dry-run]
import "dotenv/config";
import prisma from "../src/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Earliest recorded pickup per parcel, for parcels still missing the column.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; tracking_id: string; status: string; first_pickup: Date }>
  >`
    SELECT p.id, p.tracking_id, p.status::text AS status, MIN(h.created_at) AS first_pickup
    FROM parcels p
    JOIN parcel_status_history h
      ON h.parcel_id = p.id AND h.new_status::text = 'picked_up'
    WHERE p.deleted_at IS NULL AND p.picked_up_at IS NULL
    GROUP BY p.id, p.tracking_id, p.status
    ORDER BY MIN(h.created_at)
  `;

  console.log(`parcels to backfill (picked_up_at <- earliest pickup in history): ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.tracking_id}  ${r.status.padEnd(20)} -> ${r.first_pickup.toISOString()}`);
  }

  // Reported, not fixed: no pickup transition was ever recorded for these, so
  // there is nothing to recover. Counted so the gap stays visible.
  const [unrecoverable] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM parcels p
    WHERE p.deleted_at IS NULL
      AND p.picked_up_at IS NULL
      AND p.status::text NOT IN ('pickup_ordered', 'rider_assigned', 'failed_pickup', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM parcel_status_history h
        WHERE h.parcel_id = p.id AND h.new_status::text = 'picked_up'
      )
  `;
  console.log(
    `\npast pickup but no pickup ever recorded (left untouched): ${Number(unrecoverable!.count)}`,
  );

  if (dryRun) {
    console.log("\n--dry-run: no changes written.");
    return;
  }

  if (rows.length === 0) return;

  // One statement per parcel: each takes its own timestamp, so there is no
  // single updateMany that expresses this.
  let written = 0;
  for (const r of rows) {
    const res = await prisma.parcels.updateMany({
      where: { id: r.id, picked_up_at: null },
      data: { picked_up_at: r.first_pickup },
    });
    written += res.count;
  }

  console.log(`\nBackfilled ${written} parcel(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
