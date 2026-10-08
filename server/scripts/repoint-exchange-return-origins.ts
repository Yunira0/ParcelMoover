// Repoints exchange-raised return parcels whose origin was set to the
// customer's delivery zone instead of the hub that ran the delivery.
//
// A confirmed exchange delivery auto-creates the customer -> vendor return
// parcel. It used to copy the exchange's destination_location_id into the
// return's origin_location_id/current_location_id - but that is the customer's
// delivery zone (e.g. "INSIDE VALLEY - KTM"), a top-level location that no hub
// covers, so the return showed up for nobody except super_admin: branch-scoped
// order lists match origin/current against the hub's own coverage.
//
// The right value is the source parcel's current_location_id - the hub whose
// rider is carrying the return back. Only rows still sitting where they were
// created are touched; anything an operator has since moved on is left alone.
//
// Dry run by default. Pass --apply to commit.
//
// Usage:
//   npx ts-node --transpile-only scripts/repoint-exchange-return-origins.ts [--apply]
import "dotenv/config";
import prisma from "../src/lib/prisma";
import redis from "../src/lib/redis";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!APPLY) console.log("Dry run - nothing will be written. Pass --apply to commit.\n");

  const returns = await prisma.parcels.findMany({
    where: { order_type: "return", source_order_id: { not: null }, deleted_at: null },
    select: {
      id: true,
      tracking_id: true,
      status: true,
      origin_location_id: true,
      current_location_id: true,
      source_order: {
        select: { tracking_id: true, destination_location_id: true, current_location_id: true },
      },
    },
  });

  const locationNames = new Map<string, string>();
  for (const loc of await prisma.locations.findMany({ select: { id: true, name: true } })) {
    locationNames.set(loc.id, loc.name);
  }
  const label = (id: string | null) => (id ? locationNames.get(id) ?? id : "(none)");

  let repointed = 0;

  for (const ret of returns) {
    const source = ret.source_order;
    if (!source?.destination_location_id || !source.current_location_id) continue;
    // Still where creation put it: both columns on the customer's zone. A
    // return an operator has already staged or moved keeps whatever it has.
    if (ret.origin_location_id !== source.destination_location_id) continue;
    if (ret.current_location_id !== source.destination_location_id) continue;
    if (source.current_location_id === source.destination_location_id) continue;

    repointed += 1;
    console.log(
      `  ${ret.tracking_id} (${ret.status}, from ${source.tracking_id})  ` +
        `${label(ret.origin_location_id)} → ${label(source.current_location_id)}`,
    );
    if (!APPLY) continue;

    await prisma.parcels.update({
      where: { id: ret.id },
      data: {
        origin_location_id: source.current_location_id,
        current_location_id: source.current_location_id,
      },
    });
  }

  console.log(
    APPLY
      ? `\n✓ ${repointed} return parcel(s) repointed to their delivering hub.`
      : `\n${repointed} return parcel(s) would be repointed. Re-run with --apply to commit.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
