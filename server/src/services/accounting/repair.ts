// Why a statement has no journal entry, for the repair script.
//
// The usual reason is a payment method name on it - an old method, or one
// renamed since - with no ledger account, so posting refuses rather than guess
// where the money went (see cashLines in events.ts). These helpers find those
// names with the same lookup posting uses, cashAccountForMethod.
import type { Prisma } from "../../generated/prisma/client";
import { cashAccountForMethod, type MethodAccounts } from "./accounts";

export interface StatementMethods {
  /** The header's {method, amount} lines (`payments`) and its summary `payment_method`. */
  payments: Prisma.JsonValue | null;
  payment_method: string | null;
  /** Each instalment's {method, amount} lines and its own summary method. */
  instalments: Array<{ method: string | null; breakdown: Prisma.JsonValue | null }>;
}

const lineMethods = (value: Prisma.JsonValue | null): string[] =>
  Array.isArray(value)
    ? value.flatMap((line) =>
        line && typeof line === "object" && !Array.isArray(line) && typeof line.method === "string" && line.method.trim()
          ? [line.method.trim()]
          : [],
      )
    : [];

/**
 * The method names posting would look up for this statement: each line of a
 * breakdown, and a summary method only where there is no breakdown to use -
 * the same fallback paymentSplits makes.
 */
export function methodNamesOf(statement: StatementMethods): string[] {
  const names = new Set<string>();
  const add = (lines: string[], summary: string | null) => {
    if (lines.length > 0) lines.forEach((name) => names.add(name));
    else if (summary?.trim()) names.add(summary.trim());
  };
  add(lineMethods(statement.payments), statement.payment_method);
  for (const instalment of statement.instalments) add(lineMethods(instalment.breakdown), instalment.method);
  return [...names];
}

/** The names among these with no ledger account to post to. */
export function unmappedMethods(names: string[], methodAccounts: MethodAccounts): string[] {
  return names.filter((name) => !cashAccountForMethod(name, methodAccounts));
}
