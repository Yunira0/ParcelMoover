import { Request, Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { requireAdminPermission } from "../middlewares/adminPermission.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import {
  accountLedgerQuerySchema,
  createExpenseSchema,
  createManualEntrySchema,
  expensesQuerySchema,
  journalQuerySchema,
  partyBalancesQuerySchema,
  partySearchQuerySchema,
  rangeQuerySchema,
  reverseEntrySchema,
  setPeriodStatusSchema,
  createAccountSchema,
  openingBalanceSchema,
  updateAccountSchema,
  transactionsQuerySchema,
  voidExpenseSchema,
} from "../validators/accounting.schema";
import {
  createExpenseController,
  createManualEntryController,
  getAccountLedgerController,
  getBalanceSheetController,
  getJournalEntryController,
  getOverviewController,
  getPartyLedgerController,
  getPartySettlementLedgerController,
  getProfitAndLossController,
  getTrialBalanceController,
  listAccountsController,
  listChartController,
  createAccountController,
  setOpeningBalanceController,
  updateAccountController,
  listExpensesController,
  listJournalController,
  listPartyBalancesController,
  listPeriodsController,
  listTransactionsController,
  searchPartiesController,
  getPartyStatementController,
  reverseEntryController,
  setPeriodStatusController,
  voidExpenseController,
} from "../controllers/accounting.controller";

// The books show every vendor's and every rider's position, plus the whole
// firm's revenue and profit. That is a wider view than any other screen in the
// app grants, so the entire surface is staff-only and gated on a permission a
// super_admin has to delegate deliberately - the same treatment as the system
// audit logs.
//
// One grant covers the section: ACCOUNTING_ACCESS lets an admin read the books,
// post to them and close a month. The write routes still carry their own
// middleware rather than relying on the read chain, so the check is explicit at
// every entry point even though it names the same permission.
const accountingRouter: Router = Router();

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  // Fail open rather than 500 if Redis is unreachable, matching finance.routes.
  passOnStoreError: true,
  validate: false,
  store: createRedisRateLimitStore("accounting-read"),
  keyGenerator: actorOrIpKey,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many changes, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("accounting-write"),
  keyGenerator: actorOrIpKey,
});

const read = [
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("ACCOUNTING_ACCESS"),
  readLimiter,
] as const;

const write = [
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  requireAdminPermission("ACCOUNTING_ACCESS"),
  writeLimiter,
] as const;

// ── Reading the books ───────────────────────────────────────────────────────

// GET /api/accounting/overview — cash position, period result, rider holdings
accountingRouter.get("/overview", ...read, validate(rangeQuerySchema, "query"), getOverviewController);

// GET /api/accounting/accounts — the chart of accounts
accountingRouter.get("/accounts", ...read, listAccountsController);

// GET /api/accounting/journal — every entry, newest first
accountingRouter.get("/journal", ...read, validate(journalQuerySchema, "query"), listJournalController);

// GET /api/accounting/journal/:id — one entry with its lines
accountingRouter.get("/journal/:id", ...read, getJournalEntryController);

// GET /api/accounting/ledger/:code — one account's movements + running balance
accountingRouter.get("/ledger/:code", ...read, validate(accountLedgerQuerySchema, "query"), getAccountLedgerController);

// GET /api/accounting/transactions — movements on one set of accounts, newest
// first. Line-level, so a scope + direction gives a cash book directly.
accountingRouter.get(
  "/transactions",
  ...read,
  validate(transactionsQuerySchema, "query"),
  listTransactionsController,
);

// GET /api/accounting/parties/:partyType — every vendor's or rider's balance
accountingRouter.get(
  "/parties/:partyType",
  ...read,
  validate(partyBalancesQuerySchema, "query"),
  listPartyBalancesController,
);

// GET /api/accounting/parties/:partyType/:id — one party's subledger
accountingRouter.get(
  "/parties/:partyType/:id",
  ...read,
  validate(rangeQuerySchema, "query"),
  getPartyLedgerController,
);

// GET /api/accounting/parties/:partyType/:id/settlements — the same party as a
// ledger of their statements, which is what a settled statement is missing from
// the subledger above (its posting nets to zero there once it is paid)
accountingRouter.get(
  "/parties/:partyType/:id/settlements",
  ...read,
  validate(accountLedgerQuerySchema, "query"),
  getPartySettlementLedgerController,
);

// GET /api/accounting/party-search — riders, vendors and staff in one lookup
accountingRouter.get("/party-search", ...read, validate(partySearchQuerySchema, "query"), searchPartiesController);

// GET /api/accounting/statement/:partyType/:id — everything paid to or
// collected from one person, across every account
accountingRouter.get(
  "/statement/:partyType/:id",
  ...read,
  validate(rangeQuerySchema, "query"),
  getPartyStatementController,
);

// GET /api/accounting/trial-balance
accountingRouter.get("/trial-balance", ...read, validate(rangeQuerySchema, "query"), getTrialBalanceController);

// GET /api/accounting/profit-loss
accountingRouter.get("/profit-loss", ...read, validate(rangeQuerySchema, "query"), getProfitAndLossController);

// GET /api/accounting/balance-sheet
accountingRouter.get("/balance-sheet", ...read, validate(rangeQuerySchema, "query"), getBalanceSheetController);

// GET /api/accounting/periods
accountingRouter.get("/periods", ...read, listPeriodsController);

// GET /api/accounting/expenses
accountingRouter.get("/expenses", ...read, validate(expensesQuerySchema, "query"), listExpensesController);

// ── Writing to the books ────────────────────────────────────────────────────

// POST /api/accounting/expenses — record a cost and post its entry
accountingRouter.post("/expenses", ...write, validate(createExpenseSchema), createExpenseController);

// POST /api/accounting/expenses/:id/void — reverse a recorded expense
accountingRouter.post("/expenses/:id/void", ...write, validate(voidExpenseSchema), voidExpenseController);

// POST /api/accounting/journal — hand-written entry
accountingRouter.post("/journal", ...write, validate(createManualEntrySchema), createManualEntryController);

// POST /api/accounting/journal/:id/reverse — mirror-image an entry
accountingRouter.post("/journal/:id/reverse", ...write, validate(reverseEntrySchema), reverseEntryController);

// PATCH /api/accounting/periods/:periodKey — close or reopen a BS month
accountingRouter.patch("/periods/:periodKey", ...write, validate(setPeriodStatusSchema), setPeriodStatusController);

// ── Masters ─────────────────────────────────────────────────────────────────
//
// Reading the chart follows the section's own grant. Editing it does not: an
// account's type and normal side decide how every line ever posted to it is
// read, so this is a super_admin job rather than something that comes with
// ACCOUNTING_ACCESS. masters.service refuses the dangerous edits outright once
// an account has been posted to; this just keeps the door narrower.
const masters = [
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin"),
  writeLimiter,
] as const;

// GET /api/accounting/chart — the chart as a tree, with posted-line counts
accountingRouter.get("/chart", ...read, listChartController);

// POST /api/accounting/chart — add an account or a group
accountingRouter.post("/chart", ...masters, validate(createAccountSchema), createAccountController);

// PATCH /api/accounting/chart/:code — rename, regroup, deactivate
accountingRouter.patch("/chart/:code", ...masters, validate(updateAccountSchema), updateAccountController);

// POST /api/accounting/opening-balance — a starting position no source row can
// produce: cash a rider was already holding, a bank account opened with money
accountingRouter.post(
  "/opening-balance",
  ...masters,
  validate(openingBalanceSchema),
  setOpeningBalanceController,
);

export default accountingRouter;
