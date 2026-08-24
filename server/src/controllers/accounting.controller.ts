import { Request, Response } from "express";
import { AppError } from "../utils/AppError";
import {
  createExpense,
  createManualEntry,
  getAccountLedger,
  getBalanceSheet,
  getJournalEntry,
  getOverview,
  getPartyLedger,
  getPartySettlementLedger,
  getProfitAndLoss,
  getTrialBalance,
  listAccounts,
  listExpenses,
  listJournal,
  listPartyBalances,
  listPeriods,
  listTransactions,
  reverseEntry,
  searchParties,
  getPartyStatement,
  setPeriodStatus,
  voidExpense,
  type RangeQuery,
  type TransactionQuery,
} from "../services/accounting/accounting.service";
import { createAccount, listChart, setOpeningBalance, updateAccount } from "../services/accounting/masters.service";

function fail(res: Response, error: any, fallback: string) {
  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.message || fallback,
  });
}

const ok = (res: Response, data: unknown) => res.json({ success: true, data });

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** The three ways of naming a window, pulled off the query string. */
function rangeOf(req: Request): RangeQuery {
  return {
    period: str(req.query.period),
    fiscalYear: str(req.query.fiscalYear),
    from: str(req.query.from),
    to: str(req.query.to),
  };
}

// Route params are not covered by the query/body validators, and both of these
// reach raw SQL casts (`::ledger_party_type`, `::uuid`). Checking them here is
// the difference between a 400 that says what was wrong and a Postgres cast
// error surfacing as a 500.

/** The two control-account subledgers. Anything else is a typo, not a default. */
function partyTypeOf(req: Request): "vendor" | "rider" {
  const value = req.params.partyType;
  if (value !== "vendor" && value !== "rider") {
    throw new AppError(400, `Unknown party type "${value}" - expected vendor or rider`);
  }
  return value;
}

/** Statements span every account, so staff are in scope here as well. */
const STATEMENT_PARTY_TYPES = ["vendor", "rider", "user"] as const;

function statementPartyTypeOf(req: Request): (typeof STATEMENT_PARTY_TYPES)[number] {
  const value = req.params.partyType as (typeof STATEMENT_PARTY_TYPES)[number];
  if (!STATEMENT_PARTY_TYPES.includes(value)) {
    throw new AppError(400, `Unknown party type "${req.params.partyType}" - expected vendor, rider or user`);
  }
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function partyIdOf(req: Request): string {
  const value = String(req.params.id ?? "");
  if (!UUID.test(value)) throw new AppError(400, "That is not a valid party id");
  return value;
}

export async function getOverviewController(req: Request, res: Response) {
  try {
    return ok(res, await getOverview(rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load the accounting overview");
  }
}

export async function listAccountsController(req: Request, res: Response) {
  try {
    return ok(res, await listAccounts(req.query.scope === "cash_bank" ? "cash_bank" : undefined));
  } catch (error) {
    return fail(res, error, "Failed to load the chart of accounts");
  }
}

export async function listJournalController(req: Request, res: Response) {
  try {
    return ok(
      res,
      await listJournal({
        ...rangeOf(req),
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || undefined,
        accountCode: str(req.query.accountCode),
        sourceType: str(req.query.sourceType),
        status: str(req.query.status),
        search: str(req.query.search),
      }),
    );
  } catch (error) {
    return fail(res, error, "Failed to load the journal");
  }
}

export async function getJournalEntryController(req: Request, res: Response) {
  try {
    return ok(res, await getJournalEntry(req.params.id as string));
  } catch (error) {
    return fail(res, error, "Failed to load the journal entry");
  }
}

export async function getAccountLedgerController(req: Request, res: Response) {
  try {
    return ok(res, await getAccountLedger(req.params.code as string, rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load the account ledger");
  }
}

export async function listTransactionsController(req: Request, res: Response) {
  try {
    return ok(
      res,
      await listTransactions({
        ...rangeOf(req),
        // Both are validated by transactionsQuerySchema before reaching here.
        scope: req.query.scope as TransactionQuery["scope"],
        direction: str(req.query.direction) as TransactionQuery["direction"],
        accountCode: str(req.query.accountCode),
        partyId: str(req.query.partyId),
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || undefined,
        search: str(req.query.search),
      }),
    );
  } catch (error) {
    return fail(res, error, "Failed to load transactions");
  }
}

export async function listPartyBalancesController(req: Request, res: Response) {
  try {
    return ok(
      res,
      await listPartyBalances(partyTypeOf(req), {
        search: str(req.query.search),
        nonZeroOnly: req.query.nonZeroOnly === "true",
      }),
    );
  } catch (error) {
    return fail(res, error, "Failed to load party balances");
  }
}

export async function getPartyLedgerController(req: Request, res: Response) {
  try {
    return ok(res, await getPartyLedger(partyTypeOf(req), partyIdOf(req), rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load the party ledger");
  }
}

export async function getPartySettlementLedgerController(req: Request, res: Response) {
  try {
    return ok(res, await getPartySettlementLedger(partyTypeOf(req), partyIdOf(req), rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load the settlement ledger");
  }
}

export async function searchPartiesController(req: Request, res: Response) {
  try {
    return ok(res, await searchParties(String(req.query.q ?? "")));
  } catch (error) {
    return fail(res, error, "Search failed");
  }
}

export async function getPartyStatementController(req: Request, res: Response) {
  try {
    return ok(res, await getPartyStatement(statementPartyTypeOf(req), partyIdOf(req), rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load this statement");
  }
}

export async function getTrialBalanceController(req: Request, res: Response) {
  try {
    return ok(res, await getTrialBalance(rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load the trial balance");
  }
}

export async function getProfitAndLossController(req: Request, res: Response) {
  try {
    return ok(res, await getProfitAndLoss(rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load the profit and loss statement");
  }
}

export async function getBalanceSheetController(req: Request, res: Response) {
  try {
    return ok(res, await getBalanceSheet(rangeOf(req)));
  } catch (error) {
    return fail(res, error, "Failed to load the balance sheet");
  }
}

export async function listPeriodsController(_req: Request, res: Response) {
  try {
    return ok(res, await listPeriods());
  } catch (error) {
    return fail(res, error, "Failed to load accounting periods");
  }
}

export async function setPeriodStatusController(req: Request, res: Response) {
  try {
    const status = req.body.status === "open" ? "open" : "closed";
    return ok(res, await setPeriodStatus(req.user!, req.params.periodKey as string, status));
  } catch (error) {
    return fail(res, error, "Failed to update the accounting period");
  }
}

export async function listExpensesController(req: Request, res: Response) {
  try {
    return ok(
      res,
      await listExpenses({
        ...rangeOf(req),
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || undefined,
        accountCode: str(req.query.accountCode),
        status: str(req.query.status),
        partyType: str(req.query.partyType),
        partyId: str(req.query.partyId),
      }),
    );
  } catch (error) {
    return fail(res, error, "Failed to load expenses");
  }
}

export async function createExpenseController(req: Request, res: Response) {
  try {
    return res.status(201).json({ success: true, data: await createExpense(req.user!, req.body) });
  } catch (error) {
    return fail(res, error, "Failed to record the expense");
  }
}

export async function voidExpenseController(req: Request, res: Response) {
  try {
    return ok(res, await voidExpense(req.user!, req.params.id as string, req.body.reason ?? ""));
  } catch (error) {
    return fail(res, error, "Failed to void the expense");
  }
}

export async function createManualEntryController(req: Request, res: Response) {
  try {
    return res.status(201).json({ success: true, data: await createManualEntry(req.user!, req.body) });
  } catch (error) {
    return fail(res, error, "Failed to post the journal entry");
  }
}

export async function reverseEntryController(req: Request, res: Response) {
  try {
    return ok(res, await reverseEntry(req.user!, req.params.id as string, req.body.reason ?? ""));
  } catch (error) {
    return fail(res, error, "Failed to reverse the journal entry");
  }
}

// ── Masters ─────────────────────────────────────────────────────────────────

export async function listChartController(_req: Request, res: Response) {
  try {
    return ok(res, await listChart());
  } catch (error) {
    return fail(res, error, "Failed to load the chart of accounts");
  }
}

export async function createAccountController(req: Request, res: Response) {
  try {
    return res.status(201).json({ success: true, data: await createAccount(req.body) });
  } catch (error) {
    return fail(res, error, "Failed to create the account");
  }
}

export async function setOpeningBalanceController(req: Request, res: Response) {
  try {
    const { accountCode, amount, asOf, partyType, partyId, reference } = req.body;
    return res.status(201).json({
      success: true,
      data: await setOpeningBalance(
        {
          accountCode,
          amount,
          asOf: new Date(asOf),
          ...(partyType && partyId ? { party: { type: partyType, id: partyId } } : {}),
          reference,
        },
        req.user?.id ?? null,
      ),
    });
  } catch (error) {
    return fail(res, error, "Failed to record the opening balance");
  }
}

export async function updateAccountController(req: Request, res: Response) {
  try {
    return ok(res, await updateAccount(req.params.code as string, req.body));
  } catch (error) {
    return fail(res, error, "Failed to update the account");
  }
}
