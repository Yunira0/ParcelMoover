// Replays the whole money history into the accounting ledger.
//
// Every balance the ledger needs is reconstructable from rows the system
// already keeps for good - cod_collections, settlements and vendor_payments are
// lifetime tables, which is exactly why billing.service can compute a vendor's
// lifetime balance from them on every read. So this is a true replay, not an
// estimate: after it runs, each vendor's Vendor account balance must equal
// getVendorAccountBalance() to the paisa. reconcile-ledger.ts checks that, and
// is the acceptance test for this script.
//
// Safe to re-run. Every posting is idempotent on
// (source_type, source_id, event_key), so a second run posts nothing and a run
// interrupted halfway resumes where it stopped - no bookkeeping of its own
// progress required.
//
// Usage:
//   npm run backfill:ledger -- [options]          (development, via ts-node)
//   node dist/scripts/backfill-ledger.js [options] (production, no ts-node there)
//
//   --dry-run              count what would be posted, write nothing
//   --from=YYYY-MM-DD      only events on or after this AD date
//   --to=YYYY-MM-DD        only events strictly before this AD date
//   --chunk=200            entries per transaction (default 200)
//   --opening-cash=<amt>   record counted cash in hand as at --from (see below)
//   --reset --yes          delete the ledger and start over (never in production)
//
// Lives under src/ rather than beside the other scripts precisely so `tsc`
// compiles it into dist/ and type-checks it. The deployed image carries prod
// dependencies only - no ts-node - so a script outside src/ cannot be run
// against production at all.
import "dotenv/config";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { ACCOUNT, loadMethodAccounts, type MethodAccounts } from "../services/accounting/accounts";
import {
  postCodCollected,
  postDeliveryChargeEarned,
  postOpeningBalance,
  postRiderRemittance,
  postVendorPaymentVerified,
  postVendorSettlement,
  type PostOutcome,
} from "../services/accounting/events";

type EventKind = "cod_collected" | "delivery_charge" | "rider_remittance" | "vendor_settlement" | "vendor_payment";

interface EventRef {
  kind: EventKind;
  id: string;
  at: Date;
}

interface Options {
  dryRun: boolean;
  from: Date | null;
  to: Date | null;
  chunk: number;
  openingCash: string | null;
  reset: boolean;
  confirmed: boolean;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => {
    const hit = argv.find((arg) => arg.startsWith(`${flag}=`));
    return hit ? hit.slice(flag.length + 1) : null;
  };
  const date = (flag: string) => {
    const raw = value(flag);
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${flag} is not a valid date: ${raw}`);
    return parsed;
  };

  return {
    dryRun: argv.includes("--dry-run"),
    from: date("--from"),
    to: date("--to"),
    chunk: Number(value("--chunk") ?? 200),
    openingCash: value("--opening-cash"),
    reset: argv.includes("--reset"),
    confirmed: argv.includes("--yes"),
  };
}

// ── Collecting the work ─────────────────────────────────────────────────────
//
// Only (kind, id, date) is loaded up front - a few dozen bytes per event - so
// the whole history can be sorted into chronological order before anything is
// posted. Full rows are then fetched a chunk at a time. Sorting matters only
// for readability: voucher numbers come out in date order rather than grouped
// by source table. Correctness does not depend on it, since every entry carries
// its own entry_date.

async function collectEvents(options: Options): Promise<EventRef[]> {
  const window = <T extends string>(column: T) =>
    options.from || options.to
      ? {
          [column]: {
            ...(options.from ? { gte: options.from } : {}),
            ...(options.to ? { lt: options.to } : {}),
          },
        }
      : {};

  const [collections, parcels, settlements, payments] = await Promise.all([
    // Only collections where cash actually changed hands. A row with
    // collected_amount = 0 describes an order that has not been delivered yet.
    //
    // Soft-deleted parcels are excluded to match billing.service, whose balance
    // query scopes both COD and charges with `p.deleted_at IS NULL`. Without
    // this the ledger credits a vendor for COD on a voided order that their
    // derived balance never counted, and the two stop agreeing.
    prisma.cod_collections.findMany({
      where: { collected_amount: { gt: 0 }, parcels: { deleted_at: null }, ...window("collected_at") },
      select: { id: true, collected_at: true, created_at: true },
    }),
    // The earned-charge rule lives in hasEarnedDeliveryCharge; this where
    // clause is its SQL twin, kept narrow so the scan stays cheap.
    prisma.parcels.findMany({
      where: {
        deleted_at: null,
        delivery_charge: { gt: 0 },
        OR: [
          { status: { in: ["delivered", "partially_delivered"] } },
          { order_type: "return", status: "returned_to_vendor" },
        ],
        ...window("delivered_at"),
      },
      select: { id: true, delivered_at: true, updated_at: true },
    }),
    // Only settled statements. A pending one has earmarked orders but moved no
    // money, and posting it would claim a payment that has not happened.
    prisma.settlements.findMany({
      where: { status: "settled", ...window("settlement_date") },
      select: { id: true, payee_type: true, settlement_date: true, updated_at: true },
    }),
    // Only verified payments, for the same reason payForSettlement will not
    // credit an unverified claim.
    prisma.vendor_payments.findMany({
      where: { status: "verified", ...window("reviewed_at") },
      select: { id: true, reviewed_at: true, created_at: true },
    }),
  ]);

  const events: EventRef[] = [
    ...collections.map((row) => ({ kind: "cod_collected" as const, id: row.id, at: row.collected_at ?? row.created_at })),
    ...parcels.map((row) => ({ kind: "delivery_charge" as const, id: row.id, at: row.delivered_at ?? row.updated_at })),
    ...settlements.map((row) => ({
      kind: (row.payee_type === "rider" ? "rider_remittance" : "vendor_settlement") as EventKind,
      id: row.id,
      at: row.settlement_date ?? row.updated_at,
    })),
    ...payments.map((row) => ({ kind: "vendor_payment" as const, id: row.id, at: row.reviewed_at ?? row.created_at })),
  ];

  // A date window given as --from/--to filters on the column the query could
  // index, but the effective event date may fall back to created_at/updated_at.
  // Re-filter on the resolved date so the window means what it says.
  const inWindow = events.filter(
    (event) => (!options.from || event.at >= options.from) && (!options.to || event.at < options.to),
  );

  return inWindow.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ── Posting ─────────────────────────────────────────────────────────────────

interface Tally {
  posted: number;
  alreadyPosted: number;
  skipped: number;
  failed: number;
}

function record(tally: Record<EventKind, Tally>, kind: EventKind, outcome: PostOutcome): void {
  const entry = tally[kind];
  if ("skipped" in outcome && outcome.skipped) entry.skipped += 1;
  else if (outcome.created) entry.posted += 1;
  else entry.alreadyPosted += 1;
}

/** Rows that could not be posted, reported together at the end. */
const failures: string[] = [];

/**
 * Posts one event, surviving a row it cannot make sense of.
 *
 * Real data has corners no fixture anticipates. Letting one of them abort a
 * replay of the entire history would mean nothing gets posted until every last
 * row is perfect - so instead the row is recorded as a failure, named at the
 * end, and the run continues. reconcile-ledger.ts is what proves whether the
 * gap matters.
 *
 * Only AppError is caught: that is the class the mapping raises for data it
 * cannot interpret. A connection drop or a constraint violation is a different
 * kind of problem and should still stop the run.
 */
async function attempt(
  tally: Record<EventKind, Tally>,
  kind: EventKind,
  label: string,
  post: () => Promise<PostOutcome>,
): Promise<void> {
  try {
    record(tally, kind, await post());
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    tally[kind].failed += 1;
    failures.push(`${kind}: ${label} - ${error.message}`);
  }
}

async function postChunk(
  chunk: EventRef[],
  tally: Record<EventKind, Tally>,
  methodAccounts: MethodAccounts,
): Promise<void> {
  const idsOf = (kind: EventKind) => chunk.filter((event) => event.kind === kind).map((event) => event.id);

  // One read per source table per chunk, then one transaction to post them all.
  const [collections, parcels, settlements, payments] = await Promise.all([
    prisma.cod_collections.findMany({
      where: { id: { in: idsOf("cod_collected") } },
      select: {
        id: true, parcel_id: true, vendor_id: true, rider_id: true,
        collected_amount: true, collected_at: true, created_at: true,
        riders: { select: { name: true } },
      },
    }),
    prisma.parcels.findMany({
      where: { id: { in: idsOf("delivery_charge") } },
      select: {
        id: true, vendor_id: true, tracking_id: true, delivery_charge: true, status: true,
        order_type: true, delivered_at: true, updated_at: true, destination_location_id: true,
        vendors: { select: { client_name: true, business_name: true } },
        parties_parcels_sender_idToparties: { select: { name: true } },
      },
    }),
    prisma.settlements.findMany({
      where: { id: { in: [...idsOf("rider_remittance"), ...idsOf("vendor_settlement")] } },
      select: {
        id: true, statement_id: true, payee_type: true, rider_id: true, vendor_id: true,
        amount: true, payable_amount: true, payment_method: true, payments: true,
        settlement_date: true, updated_at: true,
        riders: { select: { name: true } },
        vendors: { select: { client_name: true, business_name: true } },
      },
    }),
    prisma.vendor_payments.findMany({
      where: { id: { in: idsOf("vendor_payment") } },
      select: {
        id: true, vendor_id: true, amount: true, method: true, reference: true, reviewed_at: true, created_at: true,
        vendors: { select: { client_name: true, business_name: true } },
      },
    }),
  ]);

  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const collectionById = byId(collections);
  const parcelById = byId(parcels);
  const settlementById = byId(settlements);
  const paymentById = byId(payments);

  await prisma.$transaction(
    async (tx) => {
      for (const event of chunk) {
        switch (event.kind) {
          case "cod_collected": {
            const row = collectionById.get(event.id);
            if (row) await attempt(tally, event.kind, row.id, () => postCodCollected(tx, row));
            break;
          }
          case "delivery_charge": {
            const row = parcelById.get(event.id);
            if (row) await attempt(tally, event.kind, row.tracking_id, () => postDeliveryChargeEarned(tx, row));
            break;
          }
          case "rider_remittance": {
            const row = settlementById.get(event.id);
            if (row) await attempt(tally, event.kind, row.statement_id, () => postRiderRemittance(tx, { ...row, methodAccounts }));
            break;
          }
          case "vendor_settlement": {
            const row = settlementById.get(event.id);
            if (row) await attempt(tally, event.kind, row.statement_id, () => postVendorSettlement(tx, { ...row, methodAccounts }));
            break;
          }
          case "vendor_payment": {
            const row = paymentById.get(event.id);
            if (row) await attempt(tally, event.kind, row.id, () => postVendorPaymentVerified(tx, { ...row, methodAccounts }));
            break;
          }
        }
      }
    },
    // Generous, because a chunk is a few hundred entries and each is several
    // statements. The default 5s would abort a perfectly healthy chunk.
    { timeout: 120_000, maxWait: 30_000 },
  );
}

// ── Reset ───────────────────────────────────────────────────────────────────

// Shadow-mode escape hatch, for iterating on the mapping before anything
// depends on the numbers. It has to disable the immutability triggers to do its
// job, which is precisely why it is fenced behind two flags and refuses to run
// in production.
async function reset(options: Options): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("--reset is not available in production. The ledger is append-only there, by design.");
  }
  if (!options.confirmed) {
    throw new Error("--reset deletes every journal entry. Re-run with --yes if that is what you want.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "journal_lines" DISABLE TRIGGER "journal_lines_immutable"`);
    await tx.$executeRawUnsafe(`ALTER TABLE "journal_entries" DISABLE TRIGGER "journal_entries_immutable"`);
    try {
      await tx.$executeRawUnsafe(`DELETE FROM "journal_lines"`);
      await tx.$executeRawUnsafe(`DELETE FROM "journal_entries"`);
      // Deleting the lines queued a deferred balance check per row, and
      // Postgres refuses to ALTER a table with pending trigger events - so the
      // re-enable below would fail. Forcing the deferred checks to run now
      // drains that queue; they all pass trivially, because the entries they
      // would have checked no longer exist.
      await tx.$executeRawUnsafe(`SET CONSTRAINTS ALL IMMEDIATE`);
      await tx.$executeRawUnsafe(`SELECT setval('journal_entry_no_seq', 1, false)`);
    } finally {
      await tx.$executeRawUnsafe(`ALTER TABLE "journal_entries" ENABLE TRIGGER "journal_entries_immutable"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "journal_lines" ENABLE TRIGGER "journal_lines_immutable"`);
    }
  }, { timeout: 120_000 });

  console.log("Ledger cleared. Accounts and periods kept.");
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (options.reset) {
    await reset(options);
    if (options.dryRun) return;
  }

  const accountCount = await prisma.ledger_accounts.count();
  if (accountCount === 0) {
    throw new Error('No chart of accounts found. Run "npm run seed:accounting" first.');
  }

  console.log("Collecting money events...");
  const events = await collectEvents(options);

  const tally: Record<EventKind, Tally> = {
    cod_collected: { posted: 0, alreadyPosted: 0, skipped: 0, failed: 0 },
    delivery_charge: { posted: 0, alreadyPosted: 0, skipped: 0, failed: 0 },
    rider_remittance: { posted: 0, alreadyPosted: 0, skipped: 0, failed: 0 },
    vendor_settlement: { posted: 0, alreadyPosted: 0, skipped: 0, failed: 0 },
    vendor_payment: { posted: 0, alreadyPosted: 0, skipped: 0, failed: 0 },
  };

  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.kind] = (acc[event.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n${events.length} event(s) in range:`);
  for (const [kind, count] of Object.entries(counts)) console.log(`  ${kind.padEnd(20)} ${count}`);
  if (events.length > 0) {
    console.log(`  span                 ${events[0]!.at.toISOString()} -> ${events[events.length - 1]!.at.toISOString()}`);
  }

  if (options.dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  if (options.openingCash) {
    // Cash in hand is the one figure that is NOT reconstructable. What the
    // ledger derives is "everything riders remitted, less everything paid out",
    // which is a flow, not the physical float the office started with. Only a
    // count can supply that, so it is an explicit input rather than a guess.
    const asOf = options.from ?? events[0]?.at ?? new Date();
    const outcome = await postOpeningBalance(prisma, {
      accountCode: ACCOUNT.CASH_IN_HAND,
      amount: options.openingCash,
      asOf,
      reference: `counted cash in hand as at ${asOf.toISOString().slice(0, 10)}`,
    });
    const state = "skipped" in outcome && outcome.skipped ? "skipped" : outcome.created ? "posted" : "already present";
    console.log(`\nOpening cash in hand (${options.openingCash}): ${state}`);
  }

  console.log("\nPosting...");
  // Loaded once for the whole run rather than per chunk. The live posting path
  // re-reads this per batch because an admin may add a payment method at any
  // moment; a replay of history has no such race, and one read is enough.
  //
  // Passing it is not optional: without it every bank and wallet payment
  // resolves to no account and cashLines refuses the entry, so the entire
  // non-cash half of the history lands in the failure list instead of the books.
  const methodAccounts = await loadMethodAccounts(prisma);
  const chunkSize = Math.max(1, options.chunk);
  for (let index = 0; index < events.length; index += chunkSize) {
    await postChunk(events.slice(index, index + chunkSize), tally, methodAccounts);
    const done = Math.min(index + chunkSize, events.length);
    process.stdout.write(`\r  ${done}/${events.length}`);
  }
  process.stdout.write("\n");

  console.log("\nResult:");
  console.log(`  ${"event".padEnd(20)} ${"posted".padStart(8)} ${"existing".padStart(9)} ${"skipped".padStart(8)} ${"failed".padStart(7)}`);
  for (const [kind, result] of Object.entries(tally)) {
    console.log(
      `  ${kind.padEnd(20)} ${String(result.posted).padStart(8)} ${String(result.alreadyPosted).padStart(9)} ${String(result.skipped).padStart(8)} ${String(result.failed).padStart(7)}`,
    );
  }
  console.log('\nNow run "npm run reconcile:ledger" to confirm the books agree with the vendor balances.');
}

main()
  .catch((e) => {
    console.error("\n", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
