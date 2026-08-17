// Production-safe accounting seed - installs the chart of accounts and nothing
// else. Like seed-roles.ts (and unlike seed.ts, which is blocked in production
// because it creates demo users), this touches no user or money data and is
// safe to run against any environment.
//
// Idempotent: re-running updates the descriptive fields of existing accounts
// and adds any that are new. It never changes an account's `code`, `type` or
// `normal_side`, because journal_lines already reference the row - silently
// flipping an account's normal side would reinterpret every entry ever posted
// to it. A change of that kind needs a migration and a decision, not a seed.
//
// Usage: npm run seed:accounting
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { CHART_OF_ACCOUNTS } from "../src/services/accounting/accounts";

async function main() {
  let created = 0;
  let updated = 0;
  const conflicts: string[] = [];

  for (const account of CHART_OF_ACCOUNTS) {
    const existing = await prisma.ledger_accounts.findUnique({
      where: { code: account.code },
      select: { id: true, type: true, normal_side: true },
    });

    if (!existing) {
      await prisma.ledger_accounts.create({
        data: {
          code: account.code,
          name: account.name,
          type: account.type,
          normal_side: account.normalSide,
          is_control: account.isControl ?? false,
          subledger_type: account.subledgerType ?? null,
          description: account.description,
        },
      });
      created += 1;
      console.log(`  + ${account.code}  ${account.name}`);
      continue;
    }

    // The two fields that reinterpret history if changed. Report and skip
    // rather than "fixing" them behind the operator's back.
    if (existing.type !== account.type || existing.normal_side !== account.normalSide) {
      conflicts.push(
        `${account.code}: database has ${existing.type}/${existing.normal_side}, ` +
          `code expects ${account.type}/${account.normalSide}`,
      );
      continue;
    }

    await prisma.ledger_accounts.update({
      where: { id: existing.id },
      data: { name: account.name, description: account.description },
    });
    updated += 1;
  }

  console.log(`\nChart of accounts: ${created} created, ${updated} updated.`);

  if (conflicts.length > 0) {
    console.error(
      "\n✗ Refusing to change the type or normal side of an existing account - " +
        "journal entries already posted to it would change meaning:",
    );
    for (const conflict of conflicts) console.error(`    ${conflict}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
