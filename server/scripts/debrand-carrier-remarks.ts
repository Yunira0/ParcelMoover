// One-off cleanup: strip the 3PL's brand name out of remarks already stored in
// the database. Which carrier moves a parcel is our commercial arrangement, not
// something vendors or customers should read off an order timeline, so every
// rendered string now says "Courier partner" (see CARRIER_LABEL in
// ncm.service.ts). That change only affects new writes - rows written before it
// still say "NCM: Delivered (reconciled)" / "[NCM Staff] ..." on the order
// detail timeline and in the remarks column.
//
// Rewrites, in place:
//   parcel_status_history.remarks   "NCM: ..."         -> "Courier partner: ..."
//   parcel_remarks.remark           "[NCM Staff] ..."  -> "[Courier partner] ..."
//   parcel_remarks.remark           "[NCM] ..."        -> "[Courier partner] ..."
//
// Deliberately NOT touched:
//   - Handoff remarks ("Parcel dispatched to destination — order #123 → ..."),
//     which are the durable parcel → carrier-order mapping. They are matched by
//     startsWith/regex in three queries and are already brand-free.
//   - audit_logs (action "NCM_HANDOFF") and server logs: operator-facing only,
//     never rendered to vendors or customers.
//
// Safe to re-run: once rewritten, no row matches the prefixes any more.
//
// Usage:
//   ts-node --transpile-only scripts/debrand-carrier-remarks.ts [--dry-run]
import "dotenv/config";
import prisma from "../src/lib/prisma";

const CARRIER_LABEL = "Courier partner";

// [old prefix, new prefix] - order matters: "[NCM Staff]" must be rewritten
// before the shorter "[NCM]" prefix, which would otherwise match it first.
const REMARK_PREFIXES: Array<[string, string]> = [
  ["[NCM Staff]", `[${CARRIER_LABEL}]`],
  ["[NCM]", `[${CARRIER_LABEL}]`],
];
const HISTORY_PREFIX: [string, string] = ["NCM:", `${CARRIER_LABEL}:`];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const historyCount = await prisma.parcel_status_history.count({
    where: { remarks: { startsWith: HISTORY_PREFIX[0] } },
  });
  const remarkCounts = await Promise.all(
    REMARK_PREFIXES.map(([from]) =>
      prisma.parcel_remarks.count({ where: { remark: { startsWith: from } } }),
    ),
  );

  console.log(`Status-history entries to rewrite ("${HISTORY_PREFIX[0]}"): ${historyCount}`);
  REMARK_PREFIXES.forEach(([from], i) => {
    console.log(`Remarks to rewrite ("${from}"): ${remarkCounts[i]}`);
  });

  if (dryRun) {
    // Anything still naming the carrier after the prefix rewrites - e.g. a
    // human-typed remark - has to be edited by hand, so surface it now.
    const [leftoverHistory, leftoverRemarks] = await Promise.all([
      prisma.parcel_status_history.count({
        where: { remarks: { contains: "NCM" }, NOT: { remarks: { startsWith: HISTORY_PREFIX[0] } } },
      }),
      prisma.parcel_remarks.count({
        where: {
          remark: { contains: "NCM" },
          NOT: REMARK_PREFIXES.map(([from]) => ({ remark: { startsWith: from } })),
        },
      }),
    ]);
    if (leftoverHistory || leftoverRemarks) {
      console.log(
        `\nHeads up: ${leftoverHistory} history entr(ies) and ${leftoverRemarks} remark(s) mention "NCM" ` +
          `outside these prefixes (free-text notes?) - review those by hand.`,
      );
    }
    console.log("\n--dry-run: no changes written.");
    return;
  }

  const history = await prisma.$executeRaw`
    UPDATE parcel_status_history
    SET remarks = ${HISTORY_PREFIX[1]} || substring(remarks from ${HISTORY_PREFIX[0].length + 1})
    WHERE remarks LIKE ${HISTORY_PREFIX[0] + "%"}
  `;
  console.log(`\nRewrote ${history} status-history entr${history === 1 ? "y" : "ies"}.`);

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
