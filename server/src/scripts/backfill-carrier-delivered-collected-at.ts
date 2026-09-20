// One-off backfill: zero-COD parcels delivered by an external carrier (NCM /
// Upaya) never got cod_collections.collected_at stamped. applyExternalCarrierStatus
// gated that stamp on cod_amount > 0, a guard the two in-house delivery paths
// had already dropped. getUnsettledOrders and getPendingCodBill both require
// collected_at IS NOT NULL, so those parcels are invisible on the settlement
// and pending-COD screens - and, because a zero-COD delivery still owes its
// delivery charge, that charge is never billed to the vendor. They show as
// delivered on the Vendor Overview the whole time, which is how the mismatch
// surfaces (e.g. 21 delivered, 9 settleable).
//
// The carrier path now stamps collected_at for every delivery; this catches
// the backlog that transitioned before that fix shipped.
//
// Scoped to cod_amount = 0 deliberately. That is exactly the population the
// guard skipped, and the only one where stamping collected_at alone is
// correct: collected_amount is already 0, which is the truth for a zero-COD
// parcel. A delivered row with collected_at NULL *and* cod_amount > 0 did not
// come from this bug - stamping it would record zero cash against a parcel
// that carried some - so those are only reported, never written.
//
// Imports prisma and nothing else on purpose. This runs inside the deploy
// start chain, where a process that never exits would block the server from
// booting - and `|| true` does not save you from a hang, only from a non-zero
// exit. Pulling in finance.service would import lib/redis, which connects
// eagerly and retries forever, holding the event loop open. The finance cache
// it would have invalidated has a 30s TTL, so the screens correct themselves
// well before anyone looks.
//
// Usage:
//   ts-node --transpile-only src/scripts/backfill-carrier-delivered-collected-at.ts
//   ts-node --transpile-only src/scripts/backfill-carrier-delivered-collected-at.ts --commit
//   node dist/scripts/backfill-carrier-delivered-collected-at.js --commit --once   (deploy start; runs once per database)
import "dotenv/config";
import type { Prisma } from "../generated/prisma/client";
import { parcel_status } from "../generated/prisma/enums";
import prisma from "../lib/prisma";

const DELIVERED: parcel_status[] = [parcel_status.delivered, parcel_status.partially_delivered];

// Written after a committed --once run so later deploys skip it. The update
// itself is idempotent (collected_at IS NULL stops matching once stamped), so
// this is belt-and-braces: it keeps a future regression that reintroduces NULL
// collected_at from being silently settled by a deploy instead of surfacing.
const ONCE_MARKER = "BACKFILL_CARRIER_COLLECTED_AT_DONE";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--commit");
  const once = args.includes("--once");

  if (once && (await prisma.audit_logs.findFirst({ where: { action: ONCE_MARKER }, select: { id: true } }))) {
    console.log("backfill-carrier-collected-at: already applied, skipping.");
    return;
  }

  const where: Prisma.cod_collectionsWhereInput = {
    collected_at: null,
    cod_amount: 0,
    parcels: { status: { in: DELIVERED }, deleted_at: null },
  };

  const rows = await prisma.cod_collections.findMany({
    where,
    select: {
      id: true,
      parcels: {
        select: {
          order_number: true,
          status: true,
          delivery_charge: true,
          // carrier_code lives on riders, not parcels - a carrier delivery is
          // routed through a placeholder rider ("PM Rider N"/"PM Rider U").
          // Informational only: the release step in applyExternalCarrierStatus
          // nulls delivery_rider_id for a real employee, so this can be blank
          // on a genuinely affected row.
          riders_parcels_delivery_rider_idToriders: { select: { name: true, carrier_code: true } },
        },
      },
    },
  });

  console.log(`cod_collections to backfill (collected_at -> now): ${rows.length}`);
  for (const r of rows) {
    const rider = r.parcels.riders_parcels_delivery_rider_idToriders;
    const carrier = rider?.carrier_code ? `${rider.name} / ${rider.carrier_code}` : (rider?.name ?? "no rider on record");
    console.log(`  #${r.parcels.order_number} (${r.parcels.status}, ${carrier}, charge ${r.parcels.delivery_charge})`);
  }

  // Not touched by this script - flagged so a human can decide. A delivered
  // parcel that carried COD but has no collected_at has a different cause,
  // and its collected_amount cannot be inferred safely here.
  const unexplained = await prisma.cod_collections.count({
    where: {
      collected_at: null,
      cod_amount: { gt: 0 },
      parcels: { status: { in: DELIVERED }, deleted_at: null },
    },
  });
  if (unexplained > 0) {
    console.log(
      `\nWARNING: ${unexplained} delivered row(s) also have collected_at NULL but cod_amount > 0.` +
        `\nThose are NOT from this bug and are left alone - investigate before settling them.`,
    );
  }

  if (dryRun) {
    console.log("\nDry run (no --commit): no changes written.");
    return;
  }

  if (rows.length === 0) {
    console.log("\nNothing to backfill.");
  } else {
    const res = await prisma.cod_collections.updateMany({ where, data: { collected_at: new Date() } });
    console.log(`\nBackfilled ${res.count} row(s).`);
  }

  if (once) {
    await prisma.audit_logs.create({
      data: {
        actor_id: null,
        entity_type: "system",
        action: ONCE_MARKER,
        new_data: { backfilled: rows.length, unexplainedLeft: unexplained },
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
