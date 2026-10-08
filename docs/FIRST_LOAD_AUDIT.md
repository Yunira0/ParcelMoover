# First page loading audit — 5 October 2026

For a beginner-friendly explanation with diagrams and comparisons, open [the visual HTML report](FIRST_LOAD_REPORT.html).

## Findings and changes

Three import screens downloaded the spreadsheet engine before any file was selected. It is now imported when reading a spreadsheet or downloading a template. CSV-only bulk-order parsing does not need the engine. File selection clears the previous draft, prevents submission while reading, and ignores an older file's delayed result when another file is selected. File parsing and import API payloads are otherwise unchanged.

| Production build, cold JS gzip | Before | After |
| --- | ---: | ---: |
| Vendor bulk orders | 286.8 kB | 146.4 kB |
| Delivery rate settings | 287.0 kB | 146.7 kB |
| Destinations import | 291.1 kB | 151.0 kB |

The dashboard trend previously evaluated up to 90 conditional counts against every in-scope historical parcel. Its input now includes only parcels whose creation, pickup or delivery event falls within the displayed window. Each milestone is bounded independently so an old order picked up/delivered recently remains included. Lifetime overview and COD figures keep their original all-time basis. Actor scope, soft deletes and Nepal day boundaries are preserved. No indexes, connection-pool settings, cache TTLs or production data were changed.

## Synthetic query benchmark

100,000 synthetic parcels spread across two years and 20 vendors, using an in-memory PostgreSQL runtime (PGlite). The fixture has the existing creation-date, delivery-date and vendor indexes; it does not add a pickup-date index. Before/after result rows must match exactly. Times are the median of four EXPLAIN ANALYZE executions after a correctness/warm-up run, measured without the test suite running concurrently. They are query execution timings in a synthetic fixture, not cold production database timings or page-load guarantees.

| Scope | Window | Before | After |
| --- | ---: | ---: | ---: |
| admin | 7 days | 111.94 ms | 21.78 ms |
| vendor | 7 days | 7.39 ms | 1.84 ms |
| admin | 30 days | 308.43 ms | 28.93 ms |
| vendor | 30 days | 17.28 ms | 2.85 ms |

Reproduce from `server/`: `node scripts/benchmark-dashboard-trend.cjs`. The benchmark never connects to DATABASE_URL and creates its tables only in memory. Correctness tests additionally cover vendor/sales/branch/rider scope, partial deliveries, soft deletes, old orders with recent events, malformed vendor IDs, and both ends of Nepal day boundaries.

## Public production samples

Unauthenticated requests to `https://portal.parcelmoover.com/login` returned the HTML first byte in 373–467 ms in two single samples. The document had `max-age=0`, gzip, and Cloudflare DYNAMIC. The entry JavaScript had Cloudflare HIT with a 16 ms first byte; six shared JavaScript files had MISS with first-byte times of 266–537 ms. One MISS response took 814 ms including body download. These were sequential command-line samples, not a browser waterfall, not proof of an empty browser cache, and not representative percentiles. The asset cache policy was already one-year immutable caching. The live filenames differed from this checkout's build.

Authenticated API timings and actual database plans were not captured: the live browser was signed out, and the local DATABASE_URL points to a stopped localhost database. No production writes, database flushes or load tests were run.

## Request diagnostics for dashboard and Partner API

Set `PERFORMANCE_TIMING=true` on the server and restart to enable optional `Server-Timing` headers and JSON request logs for `/api`, including `/api/v1`. The default is off. Metrics are:

- `api`: elapsed time through response-header creation; the log records time through response completion.
- `db`: accumulated duration of logical Prisma operations, including client/pool overhead. Parallel operation durations overlap and can exceed `api`; this is not pure SQL execution time.
- `auth`: session/API-key authentication time, stopped before the downstream handler starts. It overlaps the database operations used during authentication.
- `db_ops`: count of logical Prisma operations, not an exact count of SQL statements or nested relation fetches.

Logs record method, route template, status and timings. They omit SQL, parameters, URL query strings, payloads, credentials and user/vendor identifiers. Public API authentication, structured errors, idempotency, vendor scope and data freshness keep their existing rules. Detailed database inspection remains an operator task. Neither this diagnostic option nor browser asset deferral adds a Partner API capability.

## Remaining measurements, ranked

1. Record first and repeat navigations for dashboard, orders, finance, reports and settings. Use browser Network timing to separate JavaScript/CSS downloads from API waits, and read Server-Timing after deploying diagnostics. Collect multiple samples and p50/p95 by page and role; keep cold-browser, cache-miss and cache-hit cases separate. A cached API request can still perform authentication/scope queries.
2. If API waits dominate, capture the actual PostgreSQL version, table sizes, deployed indexes, query statistics, execution plans, pool waiting count and Redis health. Check the existing `DB_POOL_MAX=60` per-process default against real database limits and replica count before tuning it.
3. Assess global order-cache invalidation and branch dashboard cache misses using that workload. Broader caching changes need correctness checks around mutations and freshness; do not simply lengthen the TTL.
4. Consider vendor-scoped order sorting, return-event timestamp and latest-settlement indexes only where plans show a benefit. Check concurrent index-build compatibility with the migration runner before selecting a rollout procedure.
5. If code downloads dominate, investigate grouping the many small shared chunks or navigation-intent preloading while retaining current route/role splitting. The file counts below measure emitted imports, not additional sequential network round trips.

## Validation

The production build and all eight compressed loading budgets pass. Server TypeScript compilation and all 32 focused query, authentication, timing and ownership checks pass. A local browser smoke check parsed one synthetic Excel row in each of the bulk-order, destination and delivery-rate import forms and showed each row as valid. No import submission was made; the temporary preview blocks API writes. The full server suite reports 616 passing tests and one unrelated existing voucher-export assertion: a fixture expiring on 1 October 2026 is expected to remain unclaimed despite the current date being 5 October. Voucher code was not changed for this task. Partner API documentation was regenerated with `npm run docs:build`.

## Page-by-page download work

This is build output for every dynamically imported page module, including modules embedded inside other pages. It is not a list of API response times. Cold values include startup/shared imports and, for workspace pages, the navigation shell. Extra JS excludes files already loaded by that shell; other prior page visits may reuse more. CSS and JavaScript are gzip estimates; API responses, imagery, HTML and optional actions are excluded.

Reproduce from `client/`: `npm run check:performance` then `node scripts/report-loading-costs.mjs` (or `--json`).

| Page | Cold JS, gzip kB | Cold CSS, gzip kB | Extra JS after shell, kB | JS files |
| --- | ---: | ---: | ---: | ---: |
| Home | 107.9 | 5.0 | — | — |
| AdminFormPage | 142.6 | 11.8 | 15.2 | 55 |
| AdminManagement | 144.3 | 15.1 | 16.9 | 57 |
| AnnouncementFormPage | 135.7 | 11.4 | 8.2 | 48 |
| AnnouncementManagement | 131.9 | 10.1 | 4.5 | 47 |
| BannerFormPage | 137.9 | 12.1 | 10.5 | 50 |
| BannerManagement | 132.3 | 10.1 | 4.8 | 47 |
| BillingManagement | 145.5 | 17.0 | 18.0 | 59 |
| CodSettlementDetailPage | 135.6 | 10.2 | 8.1 | 48 |
| CodSettlementRequests | 140.2 | 14.8 | 12.7 | 56 |
| CreateOrderPage | 146.8 | 13.3 | 19.4 | 58 |
| Dashboard | 145.5 | 13.0 | 18.1 | 56 |
| DashboardRouter | 128.7 | 7.8 | 1.3 | 40 |
| DeliveryRateSettings | 146.7 | 15.0 | 19.3 | 62 |
| DispatchOperations | 170.4 | 14.5 | 42.9 | 55 |
| ForceChangePasswordPage | 110.2 | 5.7 | — | 10 |
| HoldOperations | 162.4 | 12.5 | 34.9 | 51 |
| KycApplicationPage | 123.4 | 8.9 | — | 21 |
| Login | 119.0 | 7.6 | — | 14 |
| LossAndDamageOperations | 159.8 | 10.7 | 32.3 | 50 |
| MerchantOverview | 144.8 | 13.9 | 17.3 | 58 |
| OOVOperations | 176.9 | 17.3 | 49.5 | 65 |
| OrderDetailPage | 171.4 | 15.8 | 44.0 | 57 |
| OrderManagement | 183.9 | 17.7 | 56.4 | 70 |
| OrdersRouter | 128.7 | 7.8 | 1.2 | 40 |
| OverviewOrdersPage | 137.8 | 10.7 | 10.3 | 52 |
| PickupOperations | 169.7 | 14.8 | 42.2 | 55 |
| PickupTimeSlots | 130.6 | 9.7 | 3.2 | 45 |
| ProfilePage | 139.5 | 12.9 | 12.0 | 53 |
| RemarkDetail | 132.3 | 10.3 | 4.9 | 43 |
| Remarks | 135.6 | 12.4 | 8.1 | 49 |
| ReportsPage | 135.3 | 10.3 | 7.8 | 48 |
| ReturnOperations | 176.4 | 15.4 | 49.0 | 58 |
| RiderFormPage | 141.6 | 11.8 | 14.1 | 55 |
| RiderManagement | 143.6 | 15.0 | 16.1 | 57 |
| RiderRunSheet | 143.2 | 14.1 | 15.7 | 53 |
| SettlementCreatePage | 141.5 | 13.4 | 14.1 | 55 |
| SettlementDetailPage | 141.2 | 14.3 | 13.7 | 55 |
| SettlementPayPage | 142.2 | 13.5 | 14.7 | 54 |
| SlaSettings | 135.3 | 11.3 | 7.8 | 47 |
| SystemLogs | 133.9 | 11.5 | 6.5 | 46 |
| TicketDetail | 131.3 | 10.3 | 3.9 | 45 |
| Tickets | 142.8 | 14.8 | 15.3 | 55 |
| TrackParcel | 116.5 | 6.7 | — | 12 |
| TrashOrdersPage | 136.6 | 11.6 | 9.1 | 49 |
| UnclosedRemarks | 132.8 | 10.8 | 5.3 | 46 |
| VendorFormPage | 145.9 | 12.0 | 18.4 | 57 |
| VendorKycStartPage | 142.2 | 13.3 | 14.8 | 58 |
| VendorManagement | 148.0 | 16.2 | 20.6 | 61 |
| Vouchers | 157.2 | 18.8 | 29.7 | 64 |
| accounting/AccountingOverview | 138.9 | 14.0 | 11.5 | 57 |
| accounting/CodPage | 142.9 | 14.8 | 15.5 | 60 |
| accounting/JournalPage | 144.9 | 17.0 | 17.5 | 63 |
| accounting/LedgerReportPage | 140.0 | 14.0 | 12.6 | 56 |
| accounting/PartySearchPage | 133.7 | 11.9 | 6.2 | 50 |
| accounting/TransactionsPage | 138.7 | 15.6 | 11.2 | 57 |
| branch/BranchBilling | 147.6 | 17.0 | 20.1 | 60 |
| branch/BranchDestinations | 132.2 | 11.7 | 4.8 | 46 |
| branch/BranchOverview | 147.4 | 17.6 | 19.9 | 65 |
| branch/BranchSettlement | 140.5 | 14.8 | 13.1 | 58 |
| branch/BranchSettlementCreatePage | 139.3 | 12.7 | 11.8 | 51 |
| branch/BranchSettlementDetailPage | 142.4 | 16.6 | 14.9 | 59 |
| finance/CashBankPage | 134.7 | 13.6 | 7.2 | 47 |
| finance/CashBankVoucherPage | 139.4 | 14.4 | 12.0 | 54 |
| finance/JournalVoucherPage | 130.6 | 10.0 | 3.2 | 43 |
| finance/LedgerSheetPage | 134.8 | 11.9 | 7.4 | 48 |
| finance/MastersPage | 141.2 | 15.9 | 13.8 | 56 |
| finance/SettlementLedgerPage | 136.0 | 12.4 | 8.6 | 49 |
| sales/SalesDashboard | 140.5 | 11.6 | 13.0 | 50 |
| settings/DestinationsImport | 151.0 | 15.0 | 23.6 | 63 |
| settings/Settings | 142.0 | 14.0 | 14.6 | 57 |
| vendor/BulkOrderPage | 146.4 | 13.5 | 19.0 | 54 |
| vendor/StaffFormPage | 137.0 | 11.8 | 9.6 | 47 |
| vendor/VendorAnnouncementDetailPage | 128.8 | 8.5 | 1.3 | 41 |
| vendor/VendorAnnouncementsPage | 128.8 | 8.8 | 1.3 | 42 |
| vendor/VendorBilling | 135.8 | 11.6 | 8.4 | 51 |
| vendor/VendorCodSettlementRequests | 139.3 | 12.9 | 11.9 | 55 |
| vendor/VendorDashboard | 142.4 | 14.1 | 15.0 | 53 |
| vendor/VendorDeliveryCharges | 133.1 | 10.8 | 5.6 | 46 |
| vendor/VendorDeveloper | 137.4 | 12.5 | 9.9 | 48 |
| vendor/VendorMetricDetail | 135.2 | 10.2 | 7.8 | 46 |
| vendor/VendorOrderPayments | 134.0 | 11.4 | 6.6 | 49 |
| vendor/VendorOrders | 169.8 | 16.0 | 42.4 | 57 |
| vendor/VendorPendingCod | 130.9 | 9.7 | 3.5 | 44 |
| vendor/VendorPrintSettings | 130.6 | 9.0 | 3.2 | 43 |
| vendor/VendorSettlements | 134.4 | 11.8 | 7.0 | 48 |
| vendor/VendorUserManagement | 139.4 | 14.0 | 12.0 | 51 |
