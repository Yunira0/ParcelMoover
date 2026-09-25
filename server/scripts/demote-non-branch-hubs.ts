// Un-marks destinations that were saved as hubs without ever being made a branch.
//
// Destination Management and the destination import used to create every
// destination with is_hub = true, so a plain destination looked exactly like a
// branch - and branch balances, Branch Overview, the hub pickers on the
// admin/rider/vendor forms and the Rates origin list all treated it as one.
// Only Add Branch (branch.service createOrPromoteBranch) should make a branch.
//
// A top-level hub is kept as a branch when any of these hold:
//   - it was created or promoted through Add Branch (audit log, or the
//     commission_per_parcel that Add Branch always sets)
//   - it is Imadol, the head office
// Otherwise it is demoted to a plain destination - unless admins, riders or
// vendors are still assigned to it. Demoting those would break their branch
// scope and hub pickers, so they are listed for you to either add as a branch
// through Add Branch or reassign first, and left untouched.
//
// Dry run by default. Pass --apply to commit.
//
// Usage:
//   npx ts-node --transpile-only scripts/demote-non-branch-hubs.ts [--apply]
import "dotenv/config";
import prisma from "../src/lib/prisma";
import redis from "../src/lib/redis";
import { invalidateDestinationPricingCache } from "../src/services/pricing.service";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!APPLY) console.log("Dry run - nothing will be written. Pass --apply to commit.\n");

  const hubs = await prisma.locations.findMany({
    where: { parent_id: null, is_hub: true },
    select: {
      id: true,
      name: true,
      code: true,
      commission_per_parcel: true,
      _count: { select: { admins: true, riders: true, vendors: true } },
    },
    orderBy: { name: "asc" },
  });

  const promoted = new Set(
    (
      await prisma.audit_logs.findMany({
        where: { entity_type: "branch", action: "CREATE_OR_PROMOTE_BRANCH" },
        select: { entity_id: true },
      })
    ).map((log) => log.entity_id),
  );

  const kept: string[] = [];
  const inUse: string[] = [];
  const demote: { id: string; name: string }[] = [];

  for (const hub of hubs) {
    const isHeadOffice = hub.code?.trim().toUpperCase() === "IMADOL";
    if (isHeadOffice || promoted.has(hub.id) || hub.commission_per_parcel !== null) {
      kept.push(hub.name);
      continue;
    }
    const { admins, riders, vendors } = hub._count;
    if (admins + riders + vendors > 0) {
      inUse.push(`${hub.name}  (${admins} admin(s), ${riders} rider(s), ${vendors} vendor(s))`);
      continue;
    }
    demote.push({ id: hub.id, name: hub.name });
  }

  console.log(`Branches kept (${kept.length}):`);
  kept.forEach((name) => console.log(`  ✓ ${name}`));
  console.log(`\nNot a branch, but still in use - left as is (${inUse.length}):`);
  inUse.forEach((line) => console.log(`  ! ${line}`));
  console.log(`\nPlain destinations to un-mark (${demote.length}):`);
  demote.forEach((d) => console.log(`  - ${d.name}`));

  if (APPLY && demote.length) {
    await prisma.locations.updateMany({
      where: { id: { in: demote.map((d) => d.id) } },
      data: { is_hub: false },
    });
    await invalidateDestinationPricingCache();
  }

  console.log(
    APPLY
      ? `\n✓ ${demote.length} destination(s) un-marked as branches.`
      : `\n${demote.length} destination(s) would be un-marked. Re-run with --apply to commit.`,
  );
  if (inUse.length) {
    console.log("Add the in-use ones through Branch Overview → Add Branch, or reassign their people, then re-run.");
  }
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
