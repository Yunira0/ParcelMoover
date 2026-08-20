// One-off cleanup: strip the 3PL's brand name out of remarks already stored in
// the database. Which carrier moves a parcel is our commercial arrangement, not
// something vendors or customers should read off an order timeline, so every
// rendered string now says "Courier partner" (see CARRIER_LABEL in
// src/utils/carrierRemark.ts). That change only affects new writes - rows written before it
// still say "NCM: Delivered (reconciled)" / "[NCM Staff] ..." on the order
// detail timeline and in the remarks column.
//
// Covers both 3PLs. Upaya kept writing its own name long after NCM was
// debranded, so one timeline could show "Courier partner: Delivered" on one
// parcel and "Upaya: Delivered" on the next.
//
// Rewrites, in place:
//   parcel_status_history.remarks   "NCM: ..."          -> "Staff: ..."
//   parcel_status_history.remarks   "Upaya: ..."        -> "Staff: ..."
//   parcel_status_history.remarks   "Courier partner:"  -> "Staff: ..."
//   parcel_remarks.remark           "[NCM Staff] ..."   -> "[Courier partner] ..."
//   parcel_remarks.remark           "[NCM] ..."         -> "[Courier partner] ..."
//   parcel_remarks.remark           "[Upaya Staff] ..." -> "[Courier partner] ..."
//   parcel_remarks.remark           "[Upaya] ..."       -> "[Courier partner] ..."
//
// Deliberately NOT touched:
//   - Handoff remarks, the durable parcel → carrier-order mapping, matched by
//     startsWith/regex in several queries and in raw SQL. NCM's ("Parcel
//     dispatched to destination — order #123 → ...") is already brand-free.
//     Upaya's ("Parcel dispatched via Upaya — ...") is NOT, but rewriting it
//     would orphan every in-flight parcel from its carrier order - the readers
//     have to be taught both spellings before that text can move.
//   - audit_logs (action "NCM_HANDOFF") and server logs: operator-facing only,
//     never rendered to vendors or customers.
//
// Safe to re-run: once rewritten, no row matches the prefixes any more.
//
// Usage:
//   ts-node --transpile-only scripts/debrand-carrier-remarks.ts [--dry-run]
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { CARRIER_AUTHOR_LABEL, CARRIER_LABEL } from "../src/utils/carrierRemark";

// Every carrier name that has ever reached a rendered string.
const CARRIER_NAMES = ["NCM", "Upaya"];

// [old prefix, new prefix] - order matters: "[NCM Staff]" must be rewritten
// before the shorter "[NCM]" prefix, which would otherwise match it first.
const REMARK_PREFIXES: Array<[string, string]> = CARRIER_NAMES.flatMap((name) => [
  [`[${name} Staff]`, `[${CARRIER_LABEL}]`] as [string, string],
  [`[${name}]`, `[${CARRIER_LABEL}]`] as [string, string],
]);
// Status-update lines now read "Staff: delivered". Rows written before that
// say "NCM: ...", "Upaya: ..." or - from the first, half-finished debrand -
// "Courier partner: ...". displayRemarkText normalises all three on read, so
// this pass is housekeeping rather than a prerequisite.
const HISTORY_PREFIXES: Array<[string, string]> = [...CARRIER_NAMES, CARRIER_LABEL].map(
  (name) => [`${name}:`, `${CARRIER_AUTHOR_LABEL}:`],
);

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const historyCounts = await Promise.all(
    HISTORY_PREFIXES.map(([from]) =>
      prisma.parcel_status_history.count({ where: { remarks: { startsWith: from } } }),
    ),
  );
  const remarkCounts = await Promise.all(
    REMARK_PREFIXES.map(([from]) =>
      prisma.parcel_remarks.count({ where: { remark: { startsWith: from } } }),
    ),
  );

  HISTORY_PREFIXES.forEach(([from], i) => {
    console.log(`Status-history entries to rewrite ("${from}"): ${historyCounts[i]}`);
  });
  REMARK_PREFIXES.forEach(([from], i) => {
    console.log(`Remarks to rewrite ("${from}"): ${remarkCounts[i]}`);
  });

  if (dryRun) {
    // Anything still naming the carrier after the prefix rewrites - e.g. a
    // human-typed remark - has to be edited by hand, so surface it now.
    const [leftoverHistory, leftoverRemarks] = await Promise.all([
      prisma.parcel_status_history.count({
        where: {
          OR: CARRIER_NAMES.map((name) => ({ remarks: { contains: name } })),
          NOT: HISTORY_PREFIXES.map(([from]) => ({ remarks: { startsWith: from } })),
        },
      }),
      prisma.parcel_remarks.count({
        where: {
          OR: CARRIER_NAMES.map((name) => ({ remark: { contains: name } })),
          NOT: REMARK_PREFIXES.map(([from]) => ({ remark: { startsWith: from } })),
        },
      }),
    ]);
    if (leftoverHistory || leftoverRemarks) {
      console.log(
        `\nHeads up: ${leftoverHistory} history entr(ies) and ${leftoverRemarks} remark(s) name a carrier ` +
          `outside these prefixes (free-text notes, or Upaya's handoff remark) - review by hand.`,
      );
    }
    console.log("\n--dry-run: no changes written.");
    return;
  }

  for (const [from, to] of HISTORY_PREFIXES) {
    const n = await prisma.$executeRaw`
      UPDATE parcel_status_history
      SET remarks = ${to} || substring(remarks from ${from.length + 1})
      WHERE remarks LIKE ${from + "%"}
    `;
    console.log(`\nRewrote ${n} status-history entr${n === 1 ? "y" : "ies"} from "${from}".`);
  }

  for (const [from, to] of REMARK_PREFIXES) {
    const n = await prisma.$executeRaw`
      UPDATE parcel_remarks
      SET remark = ${to} || substring(remark from ${from.length + 1})
      WHERE remark LIKE ${from + "%"}
    `;
    console.log(`Rewrote ${n} remark(s) from "${from}".`);
  }

  console.log("\nRemember to clear the order Redis cache (or wait for TTL) so the UI reflects the change.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
