# Order service refactor

## Outcome

On 2026-09-24, `src/services/order.service.ts` was reduced from 7,130 lines to an 81-line public entry point. Its original 52 public exports remain available to controllers, carrier integrations, manifests, and tests. Implementation lives in focused modules under `src/services/orders/`.

The server build passes (`prisma generate && tsc`). The full Vitest suite passes: 43 files and 548 tests, up from the 537-test baseline. Eleven new characterization tests cover settlement protection, partial-delivery cash preservation, and external carrier status behavior.

## Module boundaries

| Area | Modules |
| --- | --- |
| Commands | `create.ts`, `edit.ts`, `redirect.ts`, `bulkCreate.ts`, `trash.ts`, `orderHelpers.ts` |
| Reads and reporting | `where.ts`, `query-core.ts`, `query-detail.ts`, `dashboard.ts`, `cod-detail.ts`, `operations-reporting.ts`, `senderProfile.ts` |
| Status workflows | `status-single.ts`, `status-bulk.ts`, `status-carrier.ts`, `status-shared.ts`, `statusLocks.ts` |
| Shared services | `scope.ts`, `pricing.ts`, `cache.ts`, `notifications.ts`, `remarks.ts`, `remarkAuthor.ts`, `types.ts` |

The single, bulk, and carrier status paths remain separate because they have different transaction shapes and side effects. Shared rules and the parcel lock are in lower-level modules. The order facade imports no implementation directly; it only re-exports the existing API. New order modules do not import the facade.

## Dependency decisions

- Carrier handoff prefixes now come directly from `utils/carrierRemark.ts`, removing the former order-to-NCM/Upaya runtime cycle. The stored prefix strings did not change.
- Order scope uses `lib/branchScope.resolveBranchCoverageIds`, equivalent for a defined branch ID to `branch.service.resolveBranchLocationIds`. This removes the order-to-branch runtime cycle without changing the order visibility rule.
- Status and command modules share tracking and run-sheet helpers through `orderHelpers.ts`, so neither workflow imports the other.
- The remark-to-NCM sync remains a dynamic import after the remark is written; its relative path was updated for the new module location.

## Behavior and verification guardrails

- Preserve order scope, transition rules, error responses, transaction boundaries, COD settlement checks, manifest membership, history and audit writes, webhook outbox writes, and post-commit cache/billing/notification effects during future changes.
- `statusLocks.ts` retains the existing Redis key, 15-second TTL, contention response, and best-effort behavior on Redis failure. Bulk status keeps the lock around its whole ID set, including sequential manifest groups.
- The full test suite and production TypeScript build passed after extraction. There are no direct imports of `order.service.ts` from the new order modules, and a runtime import graph review found no path back to the facade.

## Existing issue to address separately

A settled `partially_delivered` parcel gets a 409 when moved to `follow_up` through the single-order path, while the bulk path permits the same move and preserves collected cash. The transition table permits it. This inconsistency predates the refactor and remains unchanged here. A separate behavior fix should add a regression case for the settled partial delivery before narrowing the single path's settlement guard.

## Dead-code audit

The order modules were checked with TypeScript unused-declaration and unreachable-code diagnostics plus a repository-wide export reference scan. Unused imports in `query-core.ts` and `status-bulk.ts`, an unused formatter in `query-core.ts`, and an unused exchange-return transaction result in `status-single.ts` were removed. No dead runtime function or module remains with high confidence. `HandoverParcelDto` has no in-repository consumer but remains part of the original public API, so it stays available through `order.service.ts`.
