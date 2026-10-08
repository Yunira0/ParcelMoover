# Database optimization implementation

Implemented on 6 October 2026. Application code, Prisma schema and six migrations are prepared in this checkout. All six migrations were applied successfully to the **localhost development database**, and every new index is valid. Production was neither inspected nor deployed.

## What changed, in simple language

| Before | After | Why it helps |
| --- | --- | --- |
| Order dropdowns transferred repeated parcel references and removed duplicates in JavaScript. | PostgreSQL groups the four ID dimensions; two batches fetch the names. | Transfer depends on distinct hubs/riders rather than every matching parcel. Up to six smaller queries replace four relation queries. |
| Order lists loaded complete sender, receiver, hub, vendor, rider and history relations. | Relations select only fields used by the existing response. | Less data travels to the server; labels, finance fields, staff redaction and exports retain their fields. Parcel scalar columns are still loaded. |
| Settlement lists loaded every linked collection ID to count them. | `_count.settlement_items` provides the exact number. | A statement with thousands of orders returns one count rather than thousands of IDs. Statement details remain available. |
| Newest vendor orders had separate vendor and order indexes. | An index starts with vendor ID, then descending order number and ID. | PostgreSQL can find that vendor's ordered slice directly. The full index also supports trash queries and is represented in Prisma 6. |
| Return-history queries cast status to text, without a matching status/time index. | Native enum equality and a status/time/parcel index. | The predicate and index match. Distinct-per-day counts, actor scope, soft deletes and Nepal boundaries are preserved. |
| Settlement links had an index only in the settlement-to-collection direction. | A collection-to-settlement index covers the reverse lookup. | Existence and settlement-state checks can locate links directly. |
| Owner settlement lists and user notification feeds sorted after filtering. | Owner/user + descending creation time + ID indexes; ID breaks equal-time ties. | Stable ordering and matching index paths. Existing offset pagination and exact totals remain. |
| Simultaneous default order-list cache misses repeated the same work. | One in-process computation serves each matching cache key. Date/sort filters bypass the default cache; its version changes to retire old entries. | Less burst work and no default-cache contamination by filtered queries. Failures clear the in-flight entry so later calls retry. |
| Invalid pool settings could silently become 60 connections; deployment capacity was unchecked. | Validated integer settings, an optional process-wide budget guard, and numeric start/finish pool snapshots in optional request logs. | Operators can detect waits and prevent a known deployment budget from being exceeded. The default remains 60 until measured. |
| The first query could race an asynchronous connection timeout-setting query. | The idle-transaction timeout is supplied in the PostgreSQL startup packet. | The setting is applied before checkout. This is an idle-transaction backstop, not a statement timeout. |

Cache TTLs remain 20 seconds for default order lists and 30 seconds for dashboards. Global write invalidation remains in place; targeted invalidation needs old/new vendor, rider, sales, branch and global dependency coverage. Exact `total` and `totalPages` remain on every order page, including last-page navigation. No retention deletion, index removal, autovacuum change or statistics repair was performed. The monitoring-counter discrepancy did not establish bad planner estimates.

The Partner API order/settlement endpoints already call these shared services. OpenAPI, the guide and console were updated, and the served reference was regenerated. API keys, vendor ownership, idempotency for writes, validation, rate limits and structured errors retain their behavior. Settlement payment/approval remains staff-only.

## Evidence and validation

- `npm run build`: passed after Prisma generation and TypeScript compilation.
- `npm run docs:build`: passed.
- Full server suite: 652 passed, one existing voucher CSV test failed because a fixture expired on 1 October 2026. It expected `unclaimed` but correctly received `expired`. This failure predates this work.
- Focused optimization/scope tests: all 84 passed.
- [Local service verification](database-audit/local-implementation-verification.json): six valid installed indexes; staff/vendor full-versus-selected list responses and exact totals match; grouped filter options match the old DISTINCT implementation; foreign vendor filters cannot broaden ownership. Connections use read-only PostgreSQL sessions with a 15-second statement timeout.
- [After query plans](database-audit/local-query-plans-after.json): SQL GROUP BY confirmed; origin IDs match the legacy probe; the settlement owner/reverse-link foreign-key index gaps are resolved. A small dataset can still correctly use table scans.
- [Implemented index benchmark](database-audit/implemented-index-benchmark.json): all six simplified query pairs returned identical fixture results. Four warm execution samples per variant; integer identities, simplified tables and in-memory PGlite, without concurrent builds. These are not production API timings.

| Synthetic query | Before | After |
| --- | ---: | ---: |
| Vendor order page | 0.532 ms | 0.044 ms |
| Return history: index + native enum predicate | 55.279 ms | 0.293 ms |
| Reverse settlement lookup | 21.232 ms | 0.012 ms |
| Vendor settlement page | 4.224 ms | 0.119 ms |
| Rider settlement page | 4.229 ms | 0.114 ms |
| Notification feed | 0.192 ms | 0.054 ms |

Local history counts changed between independent captures (523 at the initial audit, 524 in after plans, 525 in service verification). The local environment is active, so these snapshots are not a frozen before/after performance experiment. The verification script confirmed stable row counts during its own read-only run. Index-only SQL contains no business-row writes.

Reproduce from `server/`:

```sh
npm run build
npm run docs:build
node scripts/benchmark-database-indexes.cjs /tmp/implemented-index-benchmark.json
node scripts/audit-database-readonly.cjs /tmp/local-plans-after.json
node scripts/verify-database-optimization-readonly.cjs /tmp/local-service-verification.json
```

## Deployment procedure

1. Test on representative staging data using the actual production PostgreSQL version. Compose specifies PostgreSQL 16; successful local migration execution was on PostgreSQL 18.4. Capture API p50/p95, cache hits/misses, pool waiting counts, database plans, index sizes and write times before deployment.
2. Verify existing definitions and migration history. The local database has the historical `20260804180000_add_carriers` migration record without a matching directory in this checkout. It was preserved; these six additive migrations deployed successfully. Investigate that historical drift separately. Do not run a development reset or rewrite old migration records to hide it.
3. Review migrations `20261006100000` through `20261006100500`. Each file contains one `CREATE INDEX CONCURRENTLY` statement. Keep them outside explicit transactions; do not combine them into a batch or wrap them in `BEGIN/COMMIT`. PostgreSQL concurrent builds permit normal writes but need extra scans/resources and may wait on existing transactions. The current Prisma deployment runner successfully executed these exact files locally. [PostgreSQL concurrent build documentation](https://www.postgresql.org/docs/16/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).
4. Deploy through the existing `prisma migrate deploy` process. Verify all six names and `pg_index.indisvalid`, then compare read latency, writes, pool waits and errors. Set `DB_POOL_MAX`, `DB_APP_PROCESSES` and `DB_CONNECTION_BUDGET` from the actual deployment capacity, including rolling-deployment overlap. Budget excludes reserved database/admin/other-service headroom. Invalid or oversubscribed settings fail startup; they do not resize silently.
5. If a build fails, inspect that migration and its index definition/validity first. Do not use `IF NOT EXISTS` to skip an invalid or differently defined index. After an operator reviews the failure, drop only the failed new index concurrently, mark only that failed migration rolled back using `prisma migrate resolve --rolled-back <exact-name>`, then retry. A later successfully applied migration is not marked rolled back.
6. Rollback of application code does not require removing these indexes; they do not change answers. If a new index must be removed because of measured write/storage cost, make an explicit reviewed follow-up migration that drops only that index concurrently and update Prisma schema. Preserve all pre-existing indexes and business records.

`PERFORMANCE_TIMING=true` logs numeric `poolAtStart`/`poolAtFinish` snapshots (`max`, `total`, `idle`, `waiting`). These are point samples, not peak-wait or wait-duration measurements. No pool snapshot is added to API payloads or public health responses. SQL, parameter values and credentials are not logged. Query duration includes client/pool overhead and overlapping operations.
