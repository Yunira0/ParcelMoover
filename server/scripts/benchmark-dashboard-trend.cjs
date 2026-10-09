// Synthetic PostgreSQL benchmark. Never connects to DATABASE_URL or writes
// application data; all tables live in one disposable in-memory database.
const root = require('node:path').resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = root + '/tsconfig.json';
require(root + '/node_modules/ts-node/register/transpile-only');
const { PGlite } = require(root + '/node_modules/@electric-sql/pglite');
const { Prisma } = require(root + '/src/generated/prisma/client');
const { buildDashboardTrendQuery } = require(root + '/src/services/orders/dashboard-trend');
const assert = require('node:assert/strict');

function previousQuery(ranges, scope) {
  const columns = ranges.map(({ start, end }, i) => Prisma.sql`
    COUNT(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS ${Prisma.raw(`d${i}_total`)},
    COUNT(*) FILTER (WHERE picked_up_at >= ${start} AND picked_up_at < ${end}) AS ${Prisma.raw(`d${i}_picked_up`)},
    COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${start} AND delivered_at < ${end}) AS ${Prisma.raw(`d${i}_delivered`)}
  `);
  return Prisma.sql`SELECT ${Prisma.join(columns, ',')} FROM parcels WHERE deleted_at IS NULL ${scope}`;
}

async function executionTime(db, query) {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    const result = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.text, query.values);
    samples.push(result.rows[0]['QUERY PLAN'][0]['Execution Time']);
  }
  samples.sort((a, b) => a - b);
  return Number(((samples[1] + samples[2]) / 2).toFixed(2));
}

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE parcels (
        id integer PRIMARY KEY, vendor_id text, status text, created_at timestamptz,
        picked_up_at timestamptz, delivered_at timestamptz, deleted_at timestamptz
      );
      INSERT INTO parcels
      SELECT n, 'v' || (n % 20), CASE WHEN n % 3 = 0 THEN 'delivered' ELSE 'picked_up' END,
        timestamptz '2026-10-05 00:00:00+05:45' - ((n % 730) || ' days')::interval,
        timestamptz '2026-10-05 00:00:00+05:45' - ((n % 730) || ' days')::interval + interval '1 day',
        CASE WHEN n % 3 = 0 THEN timestamptz '2026-10-05 00:00:00+05:45' - ((n % 730) || ' days')::interval + interval '2 days' END,
        NULL
      FROM generate_series(1,100000) n;
      CREATE INDEX ON parcels(created_at DESC);
      CREATE INDEX ON parcels(delivered_at DESC);
      CREATE INDEX ON parcels(vendor_id);
      ANALYZE parcels;
    `);
    const report = [];
    for (const days of [7, 30]) {
      const start = Date.parse('2026-10-05T00:00:00+05:45') - (days - 1) * 86400000;
      const ranges = Array.from({ length: days }, (_, i) => ({
        start: new Date(start + i * 86400000), end: new Date(start + (i + 1) * 86400000),
      }));
      for (const [scopeName, scope] of [['admin', Prisma.empty], ['vendor', Prisma.sql`AND vendor_id = ${'v1'}`]]) {
        const before = previousQuery(ranges, scope);
        const after = buildDashboardTrendQuery(ranges, scope);
        const previous = await db.query(before.text, before.values);
        const optimized = await db.query(after.text, after.values);
        assert.deepEqual(optimized.rows, previous.rows);
        report.push({
          days, scope: scopeName, rows: 100000,
          beforeMs: await executionTime(db, before), afterMs: await executionTime(db, after),
        });
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
