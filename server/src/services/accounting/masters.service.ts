import prisma from "../../lib/prisma";
import type {
  ledger_account_sub_type,
  ledger_account_type,
  ledger_normal_side,
  ledger_party_type,
} from "../../generated/prisma/enums";
import { AppError } from "../../utils/AppError";
import { clearAccountCache } from "./accounts";

// ── Masters: the chart of accounts as something people can edit ─────────────
//
// Until now the chart was code: a constant in accounts.ts installed by a
// migration. That is right for the accounts the software itself posts to - if
// 2005 COD Held stopped existing, syncSettlementPostings would simply fail -
// but it left no way to add the accounts a particular business needs, which is
// most of them.
//
// So the chart is editable now, with one rule doing most of the work:
//
//   **An account that has been posted to cannot change what it means.**
//
// Its type and normal side decide how every line ever written against it is
// interpreted. Flipping `normal_side` on an account with a year of entries does
// not correct anything - it silently reverses the sign of all of them. Renaming
// is fine, re-describing is fine, deactivating is fine. Redefining is not, and
// the guard is a query rather than a convention.
//
// Groups are the same table. `parent_id` gives the chart its tree, so "Bank
// Accounts" is an account with children rather than a separate kind of thing -
// which is what lets a group total simply be the sum of its subtree.


// ── Account classes ─────────────────────────────────────────────────────────
//
// What an account is: a fixed asset, a current liability, a direct expense.
// This is the only classification anyone picks, and `type` is derived from it.
//
// It used to be two questions - type, then sub-type - which is one decision
// asked twice. Nobody thinks "expense, and then which kind"; they know it is
// rent, and rent being an expense is a consequence, not a choice. So the class
// is the input and the type falls out of it.
//
// `type` still exists because it is what every report groups by: a balance
// sheet has assets, liabilities and equity whatever a particular chart calls
// its sections, and a P&L has income and expenses. Deriving it here means the
// two can never disagree.
//
// There is no "other" in the list. A catch-all is where accounts go to stop
// being classified, and every one of them had a real home already.
const CLASS_TYPE: Record<ledger_account_sub_type, ledger_account_type> = {
  fixed_asset: "asset",
  intangible_asset: "asset",
  current_asset: "asset",
  long_term_liability: "liability",
  current_liability: "liability",
  capital: "equity",
  reserves: "equity",
  direct_income: "revenue",
  indirect_income: "revenue",
  direct_expense: "expense",
  indirect_expense: "expense",
};

/**
 * The side that increases each class.
 *
 * Only a default: `normalSide` can still be sent explicitly, which is how a
 * contra account (accumulated depreciation sitting against fixed assets) gets
 * to exist without a special case here.
 */
const CLASS_SIDE: Record<ledger_account_sub_type, ledger_normal_side> = {
  fixed_asset: "debit",
  intangible_asset: "debit",
  current_asset: "debit",
  long_term_liability: "credit",
  current_liability: "credit",
  capital: "credit",
  reserves: "credit",
  direct_income: "credit",
  indirect_income: "credit",
  direct_expense: "debit",
  indirect_expense: "debit",
};

/** Human labels, so the API is the one place that names these. */
export const SUB_TYPE_LABELS: Record<ledger_account_sub_type, string> = {
  fixed_asset: "Fixed Assets",
  intangible_asset: "Intangible Assets",
  current_asset: "Current Assets",
  long_term_liability: "Long-term Liability",
  current_liability: "Current Liability",
  capital: "Capital",
  reserves: "Reserves & Surplus",
  direct_income: "Direct Income",
  indirect_income: "Indirect Income",
  direct_expense: "Direct Expense",
  indirect_expense: "Indirect Expense",
};

/** In the order a chart of accounts is read: assets down to expenses. */
export const ACCOUNT_CLASSES = Object.keys(CLASS_TYPE) as ledger_account_sub_type[];

/** The type a class implies. Exported so callers can label without guessing. */
export function typeOfClass(subType: ledger_account_sub_type): ledger_account_type {
  return CLASS_TYPE[subType];
}

/**
 * Rejects a type that contradicts the class it arrived with.
 *
 * Callers do not have to send `type` at all - it is derived. But an old client
 * that still sends one and gets it wrong should hear about it rather than have
 * its value quietly dropped.
 */
function checkType(
  subType: ledger_account_sub_type | null | undefined,
  type: ledger_account_type | undefined,
): void {
  if (!subType || type === undefined) return;
  if (CLASS_TYPE[subType] !== type) {
    throw new AppError(
      400,
      `${SUB_TYPE_LABELS[subType]} is ${CLASS_TYPE[subType]}, not ${type}. Send the class alone and the type follows.`,
    );
  }
}

export interface AccountInput {
  code: string;
  name: string;
  /** What the account is. Everything else about its classification follows. */
  subType: ledger_account_sub_type;
  /** Derived from `subType` when absent; rejected when it contradicts one. */
  type?: ledger_account_type;
  /** Derived from `subType` when absent. Sent explicitly only for a contra. */
  normalSide?: ledger_normal_side;
  parentCode?: string | null;
  description?: string | null;
  isControl?: boolean;
  subledgerType?: ledger_party_type | null;
}

export interface AccountNode {
  id: string;
  code: string;
  name: string;
  type: ledger_account_type;
  normalSide: ledger_normal_side;
  subType: ledger_account_sub_type | null;
  parentId: string | null;
  parentCode: string | null;
  isControl: boolean;
  subledgerType: ledger_party_type | null;
  description: string | null;
  isActive: boolean;
  /** Lines posted against this account. Zero means it is still safe to redefine. */
  lineCount: number;
  /** Depth in the tree, so a flat list can still be rendered as one. */
  depth: number;
  children: AccountNode[];
}

/** How many journal lines reference an account - the "can this be redefined" test. */
async function lineCounts(): Promise<Map<string, number>> {
  const rows = await prisma.journal_lines.groupBy({
    by: ["account_id"],
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.account_id, row._count._all]));
}

/**
 * The whole chart as a tree, each node carrying how many lines it holds.
 *
 * Inactive accounts are included deliberately. An account is deactivated rather
 * than deleted precisely so its history stays readable, and a masters screen
 * that hid them would make a deactivated account impossible to reactivate.
 */
export async function listChart(): Promise<AccountNode[]> {
  const [rows, counts] = await Promise.all([
    prisma.ledger_accounts.findMany({ orderBy: { code: "asc" } }),
    lineCounts(),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const nodes = new Map<string, AccountNode>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        normalSide: row.normal_side,
        subType: row.sub_type,
        parentId: row.parent_id,
        parentCode: row.parent_id ? (byId.get(row.parent_id)?.code ?? null) : null,
        isControl: row.is_control,
        subledgerType: row.subledger_type,
        description: row.description,
        isActive: row.is_active,
        lineCount: counts.get(row.id) ?? 0,
        depth: 0,
        children: [],
      },
    ]),
  );

  const roots: AccountNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Depth is assigned by walking rather than stored, so moving an account under
  // a new parent cannot leave a stale depth behind.
  const setDepth = (node: AccountNode, depth: number) => {
    node.depth = depth;
    for (const child of node.children) setDepth(child, depth + 1);
  };
  for (const root of roots) setDepth(root, 0);

  return roots;
}

/** Resolves a parent code to its id, rejecting one that does not exist. */
async function resolveParent(parentCode: string | null | undefined): Promise<string | null> {
  if (!parentCode) return null;
  const parent = await prisma.ledger_accounts.findUnique({ where: { code: parentCode }, select: { id: true } });
  if (!parent) throw new AppError(400, `No account with code ${parentCode} to group this under`);
  return parent.id;
}

/**
 * Adds an account to the chart.
 *
 * A control account without a subledger type would collect lines it could never
 * attribute, which the database rejects anyway - checked here so the message
 * says what to fix rather than naming a constraint.
 */
export async function createAccount(input: AccountInput): Promise<AccountNode> {
  const code = input.code.trim();
  if (!/^\d{3,6}$/.test(code)) {
    // Numeric codes are what make the chart sort into its own structure, and
    // every report in this app orders by code.
    throw new AppError(400, "An account code is 3 to 6 digits, e.g. 1200");
  }
  checkType(input.subType, input.type);

  if (input.isControl && !input.subledgerType) {
    throw new AppError(400, "A control account needs a subledger type - it is what its balance is kept per");
  }

  const existing = await prisma.ledger_accounts.findUnique({ where: { code }, select: { id: true } });
  if (existing) throw new AppError(409, `Account ${code} already exists`);

  const created = await prisma.ledger_accounts.create({
    data: {
      code,
      name: input.name.trim(),
      type: CLASS_TYPE[input.subType],
      normal_side: input.normalSide ?? CLASS_SIDE[input.subType],
      sub_type: input.subType,
      parent_id: await resolveParent(input.parentCode),
      is_control: input.isControl ?? false,
      subledger_type: input.subledgerType ?? null,
      description: input.description?.trim() || null,
      is_active: true,
    },
  });

  // accounts.ts caches code -> id for the posting path; a new account has to be
  // reachable by the very next posting.
  clearAccountCache();

  return {
    id: created.id,
    code: created.code,
    name: created.name,
    type: created.type,
    normalSide: created.normal_side,
    subType: created.sub_type,
    parentId: created.parent_id,
    parentCode: input.parentCode ?? null,
    isControl: created.is_control,
    subledgerType: created.subledger_type,
    description: created.description,
    isActive: created.is_active,
    lineCount: 0,
    depth: 0,
    children: [],
  };
}

export interface AccountUpdate {
  name?: string;
  description?: string | null;
  parentCode?: string | null;
  isActive?: boolean;
  /** Derived from `subType` when that changes; rejected when it contradicts one. */
  type?: ledger_account_type;
  normalSide?: ledger_normal_side;
  subType?: ledger_account_sub_type;
}

/**
 * Edits an account.
 *
 * Presentation - name, description, grouping, active flag - is always editable.
 * Meaning is not, once anything has been posted: see the note at the top of the
 * file. The check is on lines rather than on entries because a reversed entry
 * still has lines, and its interpretation still depends on the normal side.
 */
export async function updateAccount(code: string, update: AccountUpdate): Promise<AccountNode> {
  const account = await prisma.ledger_accounts.findUnique({ where: { code } });
  if (!account) throw new AppError(404, `No account with code ${code}`);

  checkType(update.subType, update.type);

  // The type this edit lands on, whether it was sent or follows from the class.
  const nextType = update.subType ? CLASS_TYPE[update.subType] : (update.type ?? account.type);
  const nextSide = update.normalSide ?? account.normal_side;

  // Re-filing within a class is presentation - Current to Fixed Assets moves an
  // account on the balance sheet and changes nothing a posted line says. Moving
  // it across, from an asset to an expense, reinterprets every one of them, and
  // that is the edit this refuses once anything has been posted.
  const redefining = nextType !== account.type || nextSide !== account.normal_side;

  if (redefining) {
    const posted = await prisma.journal_lines.count({ where: { account_id: account.id } });
    if (posted > 0) {
      throw new AppError(
        409,
        `${code} ${account.name} already carries ${posted} posted line(s). Changing its type or normal side would ` +
          `reinterpret every one of them. Create a new account and move future postings to it instead.`,
      );
    }
  }

  // An account cannot be its own ancestor. Without this, a cycle makes listChart
  // drop the whole branch out of the tree - silently, since the rows are still
  // there and only the walk from the roots misses them.
  const parentId = update.parentCode !== undefined ? await resolveParent(update.parentCode) : account.parent_id;
  if (parentId) {
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === account.id) throw new AppError(400, "That would put the account inside itself");
      const next: { parent_id: string | null } | null = await prisma.ledger_accounts.findUnique({
        where: { id: cursor },
        select: { parent_id: true },
      });
      cursor = next?.parent_id ?? null;
    }
  }

  const saved = await prisma.ledger_accounts.update({
    where: { id: account.id },
    data: {
      ...(update.name !== undefined ? { name: update.name.trim() } : {}),
      ...(update.description !== undefined ? { description: update.description?.trim() || null } : {}),
      ...(update.parentCode !== undefined ? { parent_id: parentId } : {}),
      ...(update.isActive !== undefined ? { is_active: update.isActive } : {}),
      ...(update.subType !== undefined ? { sub_type: update.subType, type: nextType } : {}),
      ...(update.type !== undefined ? { type: update.type } : {}),
      ...(update.normalSide !== undefined ? { normal_side: update.normalSide } : {}),
    },
  });

  clearAccountCache();

  return {
    id: saved.id,
    code: saved.code,
    name: saved.name,
    type: saved.type,
    normalSide: saved.normal_side,
    subType: saved.sub_type,
    parentId: saved.parent_id,
    parentCode: update.parentCode ?? null,
    isControl: saved.is_control,
    subledgerType: saved.subledger_type,
    description: saved.description,
    isActive: saved.is_active,
    lineCount: await prisma.journal_lines.count({ where: { account_id: saved.id } }),
    depth: 0,
    children: [],
  };
}
