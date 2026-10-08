// Run from server/: node scripts/audit-database-readonly.cjs [output.json]
// Localhost only. Uses read-only transactions and never exports record values.
require('dotenv').config({ quiet: true });
const { Client, Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(root, 'tsconfig.json');
require('ts-node/register/transpile-only');
const { PrismaClient } = require('../src/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error('This audit script only permits a localhost database.');
  }
  const connection = { connectionString: url.toString(), connectionTimeoutMillis: 2000 };
  const client = new Client(connection);
  const output = { capturedAt: new Date().toISOString(), scope: 'Local development database; read-only', counts: {}, plans: {}, distinctProbe: {} };
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    for (const table of ['parcels', 'parcel_status_history', 'settlements', 'settlement_items', 'notifications', 'locations']) {
      output.counts[table] = Number((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
    }
    output.statistics = (await client.query(`
      SELECT relname, n_live_tup, n_dead_tup, last_analyze, last_autoanalyze,
             last_vacuum, last_autovacuum
      FROM pg_stat_user_tables WHERE relname IN ('parcels','parcel_status_history','locations')
      ORDER BY relname
    `)).rows;
    output.statisticsReset = (await client.query('SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()')).rows[0];
    output.plannerTableEstimates = (await client.query("SELECT relname, reltuples, relpages FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('locations','parcels','parcel_status_history') ORDER BY relname")).rows;
    output.missingForeignKeyIndexes = (await client.query(`
      SELECT t.relname AS table_name, c.conname AS constraint_name,
             ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
                   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE c.contype='f' AND n.nspname='public' AND NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid
        AND i.indpred IS NULL AND i.indexprs IS NULL
        AND i.indnkeyatts >= cardinality(c.conkey)
        AND NOT EXISTS (SELECT 1 FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
                        WHERE i.indkey[(k.ord-1)::integer] <> k.attnum)
      ) ORDER BY t.relname,c.conname
    `)).rows;
    const vendor = (await client.query('SELECT vendor_id FROM parcels WHERE vendor_id IS NOT NULL GROUP BY vendor_id ORDER BY count(*) DESC LIMIT 1')).rows[0]?.vendor_id;
    const checks = {
      vendorOrderPage: { sql: 'SELECT id,order_number FROM parcels WHERE deleted_at IS NULL AND vendor_id=$1::uuid ORDER BY order_number DESC,id DESC LIMIT 21', values: [vendor] },
      exactOrderCount: { sql: 'SELECT count(*) FROM parcels WHERE deleted_at IS NULL AND vendor_id=$1::uuid', values: [vendor] },
      returnHistory: { sql: "SELECT count(DISTINCT h.parcel_id) FROM parcel_status_history h JOIN parcels p ON p.id=h.parcel_id WHERE h.new_status='returned_to_vendor'::parcel_status AND h.created_at >= $1::timestamptz AND p.deleted_at IS NULL", values: ['2026-09-07T00:00:00+05:45'] },
      latestVendorSettlement: { sql: "SELECT amount,payable_amount,settlement_date,created_at FROM settlements WHERE status='settled' AND vendor_id=$1::uuid ORDER BY settlement_date DESC,created_at DESC LIMIT 1", values: [vendor] },
      vendorSettlementPage: { sql: "SELECT id FROM settlements WHERE payee_type='vendor' AND vendor_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 20", values: [vendor] },
    };
    for (const [key, query] of Object.entries(checks)) {
      const result = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.sql, query.values);
      // Remove row filters/index conditions, which can embed customer IDs.
      const plan = JSON.parse(JSON.stringify(result.rows[0]['QUERY PLAN'][0]));
      const strip = (node) => {
        for (const field of ['Filter','Index Cond','Recheck Cond','Hash Cond','Merge Cond','Join Filter','Output']) delete node[field];
        for (const child of node.Plans ?? []) strip(child);
      };
      strip(plan.Plan);
      output.plans[key] = { queryShape: query.sql, sampleCount: 1, plan };
    }
    await client.query('ROLLBACK');
  } finally { await client.end(); }

  // Compare the legacy Prisma DISTINCT shape with the implemented SQL grouping.
  const pool = new Pool({ ...connection, max: 1, options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: 'event', level: 'query' }] });
  const trace = [];
  prisma.$on('query', (event) => trace.push({ usesSqlDistinct: /\bDISTINCT\b/i.test(event.query), usesSqlGroupBy: /\bGROUP BY\b/i.test(event.query), durationMs: event.duration }));
  try {
    const rows = await prisma.$transaction((tx) => tx.parcels.findMany({
      where: { deleted_at: null }, distinct: ['origin_location_id'],
      select: { origin_location_id: true, locations_parcels_origin_location_idTolocations: { select: { name: true } } },
    }));
    output.distinctProbe = { queryShape: 'Legacy origin dimension, unscoped active parcels', returnedUniqueOrigins: rows.length, statements: trace.slice(), nativeDistinctEnabledInSchema: false };
    trace.length = 0;
    const grouped = await prisma.$transaction(tx => tx.parcels.groupBy({ by: ['origin_location_id'], where: { deleted_at: null } }));
    output.groupedProbe = { queryShape: 'Implemented origin dimension, unscoped active parcels', returnedUniqueOrigins: grouped.length, statements: trace.slice(), sameIds: rows.map(r => r.origin_location_id).sort().join(',') === grouped.map(r => r.origin_location_id).sort().join(',') };
  } finally { await prisma.$disconnect(); await pool.end(); }
  const target = process.argv[2];
  if (target) fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ counts: output.counts, missingForeignKeyIndexes: output.missingForeignKeyIndexes.filter(x => ['settlements','settlement_items'].includes(x.table_name)), distinctProbe: output.distinctProbe, groupedProbe: output.groupedProbe, plans: Object.fromEntries(Object.entries(output.plans).map(([k,v]) => [k, { node: v.plan.Plan['Node Type'], executionMs: v.plan['Execution Time'] }])) }, null, 2));
}
main().catch((error) => { console.error('Read-only audit failed:', error.code || error.name); process.exitCode = 1; });
