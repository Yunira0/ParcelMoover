> Implementation update (6 October 2026): query improvements and six index migrations are now implemented and applied on localhost. See [implementation details](../DATABASE_OPTIMIZATION_IMPLEMENTATION.md), [local service checks](local-implementation-verification.json), [after plans](local-query-plans-after.json) and [the six-index benchmark](implemented-index-benchmark.json). The text below records the original audit snapshot before implementation. Production has not been deployed.

# Database optimization audit — 6 October 2026

Open [the illustrated HTML report](../DATABASE_OPTIMIZATION_REPORT.html) for the complete beginner-friendly audit, ten proposed improvements, before/after diagrams, benchmark charts, an interactive connection calculator and implementation guidance.

The audit inspected the current working tree and the localhost development database using read-only transactions. No application services, endpoints, migrations, installed indexes, production data, cache lifetimes or pool settings were changed. Existing unrelated work was preserved.

## Main conclusion

Local SELECT samples are fast on a small dataset: 113 parcels, 523 history records, 17 settlements and 23 settlement links. Targeted improvements are worth validating at scale; the samples do not justify adding every candidate index immediately.

The installed Prisma origin-dropdown query performs deduplication outside SQL. Explicit database grouping plus a name lookup and narrower list projections/relation counts are useful prototypes. Vendor-order sorting, return-event filtering and reverse settlement lookups merit matching-index experiments. Exact page totals and cache changes require clearly defined contracts and scope-aware invalidation. The application defaults to 60 connections per process; the local database permits 100 total, so multiple-process deployment needs a shared capacity budget.

`pg_stat_user_tables.n_live_tup` reports zero local locations while an exact count returns 6,097. A separate check of the planner's `pg_class.reltuples` returns 6,096. The monitoring-counter mismatch does **not** establish a bad planner estimate or a need to run maintenance.

## Evidence

- `local-inventory.json`: local PostgreSQL 18.4 settings, table monitoring counters/storage, 238 index definitions including constraints, no invalid indexes, extension inventory and 119 finished migration records. Deployment Compose specifies PostgreSQL 16; production was not inspected.
- `local-query-plans.json`: exact selected row counts, five sanitized simplified SELECT plans, a conservative foreign-key index screening list, installed Prisma origin DISTINCT probe and planner table estimates. Account-valued predicates and customer records are excluded.
- `synthetic-index-benchmark.json`: disposable PGlite fixture with 200,000 parcels, 600,000 history rows and 250,000 settlement links. Four execution-plan samples per variant after a correctness/warm-up run; report medians are query execution only.
- `synthetic-trend-benchmark.json`: rerun of the existing trend benchmark with 100,000 synthetic parcels. This optimized query already existed before this audit.

| Synthetic proposed change | Before | After |
| --- | ---: | ---: |
| Vendor/order composite index | 0.509 ms | 0.043 ms |
| Return history index **and typed enum predicate** | 57.505 ms | 0.306 ms |
| Reverse settlement-link index | 20.507 ms | 0.018 ms |

Each pair returned identical fixture results. These are warm, in-memory, simplified-schema measurements, not production promises or endpoint timings. Integer fixture IDs differ from application UUIDs. The complete production index set is not replicated in the fixture. Representative distributions, full query shapes, concurrency, write/storage cost and ownership still need validation before rollout.

## Reproduce

From `server/`:

```sh
node scripts/audit-database-readonly.cjs /tmp/local-plans.json
node scripts/benchmark-database-indexes.cjs /tmp/index-benchmark.json
node scripts/benchmark-dashboard-trend.cjs
npm test -- src/services/orders/__tests__/dashboard-trend.test.ts
```

The read-only script refuses non-localhost DATABASE_URLs, uses bounded SELECT queries and exports no record values. Saved EXPLAIN conditions are stripped because they can contain identifiers. The two benchmarks use disposable in-memory databases and never connect to DATABASE_URL.

Both benchmarks completed with equal results. All 11 existing focused trend tests passed. Both new scripts and the HTML's inline JavaScript passed syntax checks. Browser verification checked desktop/mobile sizing, comparison buttons, keyboard operation, slider arithmetic, navigation and absence of console errors. Report anchors and evidence paths resolve and there are no external asset dependencies. Print styling expands technical details through the browser's print event; no PDF export is included.

Future vendor-facing changes must follow AGENTS.md: update the shared dashboard service and Partner API together; preserve vendor ownership, API-key authentication, validation, idempotency, rate limits and structured errors; update OpenAPI, the guide and console; regenerate served docs and add focused scope checks. Staff-only finance write boundaries must remain explicit.
