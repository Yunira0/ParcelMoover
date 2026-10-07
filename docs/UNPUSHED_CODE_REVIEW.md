# Review of local unpublished work

Reviewed on **6 October 2026**, against freshly fetched remote references.

**Main integration status, 6 October 2026:** all reviewed local changes and local branch tips have been committed and merged with the latest fetched `origin/main` (`087edc8`). The original stash was recovered onto `codex/stash-recovery` and merged without dropping it. Conflicts preserve current finance safeguards, carrier/accountant support, front/back KYC documents, optimized reads and reviewed fixes. Validation: **706 server tests passed across 68 files**; one real-database check was intentionally skipped. Server, client, rider, map and map-library builds passed, along with all eight loading budgets, six upload checks, seventeen historical feature checks, the map cache check and five deployment handover tests. These merge and validation steps did not change application database data. The final publication commit uses `[skip ci]` to avoid triggering the production deployment and its startup repair scripts.

The original review found four code issues and one date-dependent test fixture. Regression checks also exposed the current single-order guard blocking a legitimate settled partial-delivery continuation. That guard is now aligned with the current bulk path. The original evidence below describes the code **before repair**, rather than unresolved issues.

## Repairs and simple before/after examples

| Area | Before | After | Where the repair lives |
| --- | --- | --- | --- |
| Shared KYC documents | Rejecting a verification could later delete a vendor's original file. | Cleanup checks every vendor document field and other KYC applications first. Shared files stay available; failed checks prevent deletion. | Active checkout and `codex/feature-review-fix` worktree |
| Historical COD helper | Moving a partial delivery to follow-up could turn Rs 1,500 already collected into Rs 0. | Continuing a partial delivery preserves its cash and settlement fields. A statement-linked collection still cannot be rewritten as a completed delivery. | `codex/cod-review-fix` worktree |
| Current single-order settlement guard | A partial delivery already in a statement could be blocked from follow-up or ready-to-return. | Single and bulk operations permit follow-up/return without rewriting cash. A settled partial delivery cannot start a new collection; a completed, settled delivery cannot be reversed. | Active checkout |
| Voucher state filters | Selecting Unclaimed could show a paused code and count it as unclaimed. | Active-state filters exclude paused codes. Displayed state, results and exact totals agree. Campaign administration stays staff-only. | Active checkout and `codex/feature-review-fix` worktree |
| Voucher CSV test clock | A fixed October expiry made the test fail when the real date advanced. | Tests freeze their clock and check both unclaimed and expired output. Real voucher records are untouched. | Active checkout and `codex/feature-review-fix` worktree |
| Map print preview | Changing the paper colour left old-colour hatch tiles inside buildings. | Changing either paper or building colour rebuilds the hatch; unchanged colours reuse it. | Active `map/` project |
| Map dependency link | The local `node_modules` symlink could be included in a commit. | The ignore rule now excludes both the directory and symlink. | Active `map/.gitignore` |

## Historical repair worktrees

| Branch | Base commit | Checkout | Committed repair |
| --- | --- | --- | --- |
| `codex/cod-review-fix` | `6798210d` | `/Users/gyanendrakhatiwada/.codex/worktrees/cod-review-fix/parcelmoover-beta` | COD helper and `server/scripts/check-cod-reconciliation.cjs` |
| `codex/feature-review-fix` | `fe43ea1` | `/Users/gyanendrakhatiwada/.codex/worktrees/feature-review-fix/parcelmoover-beta` | KYC cleanup, voucher filters, voucher test clock and `server/scripts/check-review-fixes.cjs` |

The COD repair was committed as `c0489a7`; the feature repair as `eed7c20`. Both are merged into the integration history. The feature worktree was subsequently reused for the recovered stash (`855f537`); its earlier repair branch remains available. Every local branch tip is reachable from the integrated history. The original `cod`, backup, destination-validation and stash snapshots remain intact. Older implementations were reconciled into the current modular services rather than replacing newer policies with historical behavior.

The earlier approval block has been resolved: all repair patches were applied with permission to write their isolated worktrees. Historical checks execute actual source with mocked document/database effects or an in-memory SQL fixture. On the current modular service, the COD script runs the exported status-path regression suites; the feature script checks all four current document fields. The old dependency stacks were not installed or rebuilt.

## Conflict decisions and retained behavior

| Before merging | Integrated result |
| --- | --- |
| Optimization and local UI work were on a base 234 commits behind main. | Newest main security, settlement, carrier and accountant behavior is retained together with local improvements. |
| The old COD branch contained a monolithic order service and a duplicate batch warning. | The current modular service retains its payment guards. The shared import service warns about recent identical batches, allows deliberate confirmation and keeps a ten-minute replay lock for long imports. |
| The dashboard bulk warning had no matching Partner API import route. | `POST /api/v1/orders/bulk` uses key-owned vendor scope, validated rows, UUID idempotency, a 20/minute limit, structured errors and the same service. Docs, console and served reference are updated. |
| Settlement pickers could return an unbounded eligible set. | The shared service returns at most 1,000 rows with a `capped` notice, stable ordering, batch totals and unchanged vendor credit calculation. Settle the batch and reload to see more. |
| Historical voucher/KYC and stash code overlapped newer features. | Current voucher policies, credit thresholds, front/back document support, scanner routes, banners and rider confirmation remain. Duplicate route registrations and obsolete service copies are omitted. |
| A main push would automatically deploy and run startup business-data repairs. | The final publication commit skips that workflow. No migrations, backfills or production commands were run during integration. |

The one skipped server test requires a real `DATABASE_URL`; it was left unset for validation. The fresh remote fetch confirmed that no new `origin/main` commit was missing from the integrated history.

## Original findings, in priority order

### 1. P1 — Rejected KYC verification can delete an active vendor's original documents

**Found in:** unpublished backup commit `fe43ea14ad3a6ba309ba810bf9d9f6785f08336f`, branch `backup-parcel-branch-fe43ea1`. The same reference-sharing and cleanup behavior remains in the current baseline; this is an existing issue discovered while reviewing that commit, rather than a new uncommitted optimization regression.

**Code:** [current document reuse](/Users/gyanendrakhatiwada/parcelmoover-beta/server/src/services/kyc.service.ts:702), [current cleanup](/Users/gyanendrakhatiwada/parcelmoover-beta/server/src/services/kyc.service.ts:488), [original commit snapshot](/private/tmp/parcel-review-snapshots/fe43ea1/server/src/services/kyc.service.ts:686).

An existing vendor can submit verification using citizenship, PAN or business documents already on their profile. The application stores the same file paths. If staff reject it, the scheduled cleanup eventually deletes those paths after 30 days, without checking whether a vendor or another application still uses them. The vendor record continues pointing at a missing file. A later approved verification can also share that path.

**Example:** a shop has `vendor-original.jpg` on its profile → verification reuses it → verification is rejected → cleanup deletes `vendor-original.jpg` → the shop loses its existing document too.

**Evidence:** a probe ran the actual backup commit's field-resolution and cleanup functions. It confirmed that reuse copied the vendor path and that cleanup passed that same path to `unlink`. `unlink` and every database operation were mocked, so no files or records were deleted. The scheduled caller is present in [server startup](/Users/gyanendrakhatiwada/parcelmoover-beta/server/src/index.ts:215).

**Recommended correction:** protect files referenced by vendors or other applications before deleting them. Alternatively, give applications independent document copies with explicit ownership. Add a focused check covering a rejected verification that reuses a living vendor's documents.

### 2. P1 — Old COD branch zeroes real partial-delivery cash

**Found in:** unpublished commit `6798210d`, branch `cod`. **This is an old-branch restoration/cherry-pick risk. The current working implementation already preserves partial-delivery cash.**

**Code:** [old reconciliation helper](/private/tmp/parcel-review-snapshots/6798210/server/src/services/order.service.ts:3529). Original repository path at that commit: `server/src/services/order.service.ts`, lines 3529–3539. [Current preservation rule](/Users/gyanendrakhatiwada/parcelmoover-beta/server/src/services/orders/status-single.ts:120).

The old helper considers `partially_delivered` a collected status. Moving it to a normal next step, such as `follow_up` or `ready_to_return`, clears the collected amount, payment state and remittance fields. Partial delivery means the customer really handed over some cash; continuing delivery or returning the remaining goods does not undo that payment. The transition is permitted by that branch's status map.

**Example:** rider collects **Rs 1,500** on a partial delivery → staff move the remainder to follow-up → the old code records **Rs 0** collected. A collection already included in a settlement instead receives a blanket 409 rejection, blocking the same legitimate continuation.

**Evidence:** running the actual snapshot helper against a mocked Rs 1,500 collection produced `collected_amount: 0` and `collected_at: null` for `partially_delivered → follow_up`.

**Recommended correction:** preserve the current implementation's distinction between continuing a partial delivery and reversing a completed delivery. Do not restore this old helper unchanged. Cover both unsettled and settlement-linked partial deliveries.

### 3. P2 — Voucher state filters can return rows with a different displayed state

**Found in:** backup commit `fe43ea1`; also unchanged in the current baseline.

**Code:** [filter predicates](/Users/gyanendrakhatiwada/parcelmoover-beta/server/src/services/voucher-campaign.service.ts:259), [displayed-state calculation](/Users/gyanendrakhatiwada/parcelmoover-beta/server/src/services/voucher-campaign.service.ts:237).

The displayed state always becomes `paused` when a code is inactive. The SQL for `unclaimed`, `expired`, `claimed` and `redeemed` does not exclude inactive codes. The filter and its total therefore admit paused rows while the response labels them paused.

**Example:** an unused, future-dated code is paused → staff select **Unclaimed** → that code appears in the results with a **Paused** label and contributes to the unclaimed total.

**Evidence:** a probe exercised the actual snapshot query construction and result mapping. The unclaimed predicate checked expiry and missing claims but not `is_active`; an eligible inactive fixture was then mapped to `paused`. Database reads were mocked.

**Recommended correction:** use the same state precedence in the SQL predicates and result mapping, and keep page and count queries aligned. Check inactive codes across each filter.

### 4. P2 — Changing the map's Print-theme paper colour leaves the old building fill

**Found in:** the untracked standalone `map/` project.

**Code:** [hatch cache](/Users/gyanendrakhatiwada/parcelmoover-beta/map/src/renderer.ts:65), [Paper colour control](/Users/gyanendrakhatiwada/parcelmoover-beta/map/src/App.tsx:93).

The print hatch contains both the background colour and building colour, but its cache key only tracks building colour. Changing Paper repaints the map background while buildings retain tiles painted with the previous paper colour. A fresh PNG renderer can then produce a different appearance from the preview.

**Example:** choose Print → change Paper from white to red → the main background becomes red, while the buildings' hatch background remains white.

**Evidence:** the actual renderer was called twice with a mocked canvas. It created one hatch, reused it after the background change, and retained the first background colour.

**Recommended correction:** invalidate the hatch when either colour changes, or cache by both colours.

### 5. P2 — Voucher CSV test now fails because its fixed expiry date has passed

**Found in:** the test introduced by backup commit `fe43ea1`, still present in the current baseline.

**Code:** [fixture and expectation](/Users/gyanendrakhatiwada/parcelmoover-beta/server/src/services/__tests__/voucher-campaign.service.test.ts:101).

The fixture expires on **1 October 2026**, but the test always expects `unclaimed`. On the review date, the service correctly exports `expired`, so the full test command exits with failure.

**Evidence:** the full server suite completed with **652 passing / 1 failing**. The only failure was `campaign reads > exports codes as CSV`, with `expired` received where `unclaimed` was expected.

**Recommended correction:** freeze the test clock or create a fixture relative to a controlled clock. Include a separate expired-code expectation. Do not change real voucher data to satisfy this test.

## What was included

Counts below describe the checkout before adding these two report files. The [complete inventory](/Users/gyanendrakhatiwada/parcelmoover-beta/docs/UNPUSHED_CODE_REVIEW_INVENTORY.json) lists paths, sizes, hashes, branch references, commit paths and stash comparisons.

| Area | Inventory | Review result |
| --- | --- | --- |
| Uncommitted tracked changes | 91 modified files | Changes across client, rider, server, schema, Partner API and docs inspected; active builds and server tests run |
| Staged changes | 0 | Nothing staged |
| Untracked entries | 96: 95 files and 1 symlink | Includes map maker, tests, scripts, six index migrations, reports/assets and repository guidance |
| Local unpublished branch commits | 3 | Compared against all fetched remote refs, not only each branch's upstream |
| Stashes | 1, containing 132 paths | 74 files match the current checkout byte-for-byte; 58 differ; all paths already exist in the checkout |
| Worktrees | 3 | Current checkout dirty; both additional worktrees clean |

### Worktrees

| Checkout | Branch / HEAD | Pending state |
| --- | --- | --- |
| `/Users/gyanendrakhatiwada/parcelmoover-beta` | `refactorUi` / `44b8be1` | 91 tracked modifications and 96 untracked entries at review capture; no configured upstream |
| `/Users/gyanendrakhatiwada/.codex/worktrees/prod-hotfix/parcelmoover-beta` | `codex/prod-hotfix` / `b0a8a29` | Clean; its HEAD is already reachable from a remote branch |
| `/Users/gyanendrakhatiwada/pm-fix-dest` | `fix/require-order-destination` / `4533f73` | Clean; one unpublished destination-validation commit |

### Unpublished commits

| Commit | Branch | Scope |
| --- | --- | --- |
| `4533f73e671c961ffd23b5305b2a64f9268b648d` | `fix/require-order-destination` | Require destination in shared order creation and bulk preview; 2 changed files. The same guard is already present in the dirty current checkout. No additional functional bug identified in this patch. Current Partner API schema and docs also describe the destination requirement. |
| `fe43ea14ad3a6ba309ba810bf9d9f6785f08336f` | `backup-parcel-branch-fe43ea1` | Vendor credit limits, vouchers/campaigns and KYC; 106 changed paths. The commit hash is unpublished, but substantial feature code overlaps published/current code. Findings 1, 3 and 5 arise here. |
| `6798210d` | `cod` | Settlement editing, COD reconciliation and bulk order handling; 16 changed paths. Finding 2 makes restoring the old reconciliation logic unsafe. |

`ci/registry-deploy` is seven commits ahead of its configured upstream, but those commits are already reachable from other remote branches. They were therefore not counted as unpublished. Local branch names without an upstream were checked against all remote references too. No additional unpublished tag commits were found. The stash contributes three internal Git commits; these represent the one stash, not three additional branch changes.

### Stash

`stash@{0}` / `08b70aa3133023378055a6c60b33c28168fbbb35`:

> On main: wip: banner/announcements feature + pre-existing changes before secondcall merge

Reviewed the stash's tracked and untracked contents through Git and temporary snapshots. Its scope includes banners/announcements, scanner batch requests, carrier fields, document links, account forms and the rider app. Large package-lock changes and binary assets were inventoried rather than treated as handwritten code. Differences between stash snapshots and current code include later document-schema, upload, authentication and interface changes.

Because all 132 paths already exist and 74 match exactly, restoring the entire stash is not a clean way to recover a new feature. Recover specific desired changes against the current versions. The stash was not applied, popped, dropped or rewritten.

## Verification

| Check | Result |
| --- | --- |
| Server `npm run build` | Passed |
| Client `npm run check:performance` | Passed: TypeScript, production build, all 8 loading budgets and role/deferred-spreadsheet checks |
| Rider `npm run build` | Passed: TypeScript, production build and PWA output |
| Map `npm run build` | Passed: type check and standalone production build |
| Map `npm run kit:build` | Passed: reusable module, worker, CSS and geometry assets built |
| Client admin-upload checks | 6 passed |
| Full server `npm test` after fixes | 676 passed across 64 test files; zero failures |
| Focused active KYC/voucher/status checks | 48 passed |
| Historical COD helper checks | 9 passed; settled and unsettled partial continuations plus completed-delivery protections |
| Historical KYC/voucher checks | 16 passed; shared documents, failure/retry behavior, actual filter SQL, exact totals, staff scope and CSV states |
| Map renderer check | Passed: both colour changes rebuild the hatch and unchanged colours reuse it |
| Partner reference `npm run docs:build` | Passed; Markdown, OpenAPI description and console document staff/system boundaries |
| Original review probes | 4 confirmed findings before repair using actual source functions with mocked effects |
| Git whitespace check | Passed with `cr-at-eol`, preserving the repository's existing CRLF line endings; repair worktree diffs also pass |

The sandboxed full test run was unable to bind the temporary local ports used by mocked HTTP tests. The permitted rerun passed all 676 tests. No application database was used by the suite. The original pre-repair run had 652 passing tests and the one fixed-date voucher failure; the final result includes the added regression coverage.

The pending database optimization review covered lean relation selection, grouped filter dimensions, actor scope/cache eligibility, request coalescing, date-bounded dashboard queries, typed return-status queries, settlement counts, stable list ordering, six additive concurrent index migrations, pool validation and optional request timing. Current service tests exercise scope, output equivalence and query logic. This review did not execute migrations or benchmark against an application database. Performance claims in the earlier optimization report were not re-measured here.

The Partner API changes use the shared services and scoped idempotency namespaces; focused vendor-scope checks are included in the passing suite. Staff accounting, voucher administration, KYC decisions/document maintenance and delivery-status correction boundaries are documented in the Markdown, OpenAPI description and interactive console. The served reference was regenerated. Client review also covered lazy routes, deferred spreadsheet imports, import race guards, upload errors, accounting party selection and voucher line construction. Rider review covered bearer login and delivery confirmation.

### Smaller publishing detail

Resolved: `map/node_modules` is a local symlink to `../client/node_modules`. The ignore rule now uses `node_modules`, which covers a symlink as well as a directory. `git check-ignore map/node_modules` confirms it is ignored, and it no longer appears among untracked files. Build directories remain ignored.

## Limits and next steps

The full build/test runs apply to the active checkout. Older commit and stash snapshots received static review and targeted mocked reproductions; their whole historical dependency stacks were not installed or run. Binary images/fonts/gzip geometry and generated reference documents received inventory/build checks rather than exhaustive content or visual review. No production state was inspected, so this report does not claim any of the conditional bugs has occurred in production.

The identified corrections and their local verification are complete. Changes remain uncommitted for review; publishing, integration into another target branch and any production rollout are separate actions. This mixed set of pending changes was not pushed or deployed. Keep using the corrected versions when recovering historical work; restoring the original old snapshots would restore their original bugs.

Reproduction evidence is available in [the temporary probe script](/private/tmp/parcel-review-reproduce.cjs), [probe results](/private/tmp/parcel-review-reproductions.log), [server test log](/private/tmp/parcel-review-server-tests.log), [server build log](/private/tmp/parcel-review-server-build.log), [client build log](/private/tmp/parcel-review-client-build.log), [rider build log](/private/tmp/parcel-review-rider-build.log), [map build log](/private/tmp/parcel-review-map-build.log) and [map kit build log](/private/tmp/parcel-review-map-kit-build.log). These temporary files may later be cleaned by the operating system; the findings and inventory above are saved in the repository's docs folder.

Final verification logs: [server tests](/private/tmp/parcel-fixes-server-tests.log), [server build](/private/tmp/parcel-fixes-server-build.log), [client loading budgets](/private/tmp/parcel-fixes-client-build.log), [rider build](/private/tmp/parcel-fixes-rider-build.log), [map build](/private/tmp/parcel-fixes-map-build.log), [map kit build](/private/tmp/parcel-fixes-map-kit-build.log), [historical feature checks](/private/tmp/parcel-fixes-feature-tests.log) and [map cache check](/private/tmp/parcel-fixes-map-check.log). The saved inventory also includes a final repair summary; its original captured inventory remains unchanged.
