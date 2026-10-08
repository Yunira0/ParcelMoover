// Local service-equivalence check. SELECT only, no records/credentials exported.
// From server/: node scripts/verify-database-optimization-readonly.cjs [output.json]
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)) throw new Error('Localhost database required');
if (process.env.REDIS_HOST && !['localhost','127.0.0.1','::1'].includes(process.env.REDIS_HOST)) throw new Error('Localhost Redis required');
url.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=15000');
process.env.DATABASE_URL = url.toString();
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { default: prisma, pool } = require('../src/lib/prisma');
const { default: redis } = require('../src/lib/redis');
const { listOrders, mapOrder, getOrderFilterOptions } = require('../src/services/orders/query-core');
const { getActorScope } = require('../src/services/orders/scope');
const { buildOrdersWhere } = require('../src/services/orders/where');

const beforeInclude = {
  parties_parcels_sender_idToparties: true, parties_parcels_receiver_idToparties: true,
  locations_parcels_origin_location_idTolocations: true, locations_parcels_destination_location_idTolocations: true,
  vendors: true, riders_parcels_pickup_rider_idToriders: true, riders_parcels_delivery_rider_idToriders: true,
  parcel_remarks: { orderBy: { created_at: 'desc' }, take: 1 },
  parcel_status_history: { orderBy: { created_at: 'desc' }, take: 1, include: { users: { include: { user_roles: { include: { roles: true } } } } } },
  cod_collections: { select: { collected_amount: true } },
};
const names = [
  'idx_parcels_vendor_order_number_id','idx_parcel_history_status_created_parcel',
  'idx_settlement_items_cod_settlement','idx_settlements_vendor_created_id',
  'idx_settlements_rider_created_id','idx_notifications_user_created_id',
];
const normalizeOptions = result => ({
  origins: result.origins.sort((a,b) => a.id.localeCompare(b.id)),
  destinations: result.destinations.sort((a,b) => a.id.localeCompare(b.id)), riders: result.riders.sort(),
});

async function main() {
  const report = { capturedAt: new Date().toISOString(), scope: 'Localhost, read-only service checks; no production deployment', checks: [] };
  report.sessionSettings = (await prisma.$queryRawUnsafe("SELECT current_setting('default_transaction_read_only') AS read_only, current_setting('idle_in_transaction_session_timeout') AS idle_transaction_timeout, current_setting('statement_timeout') AS statement_timeout"))[0];
  assert.equal(report.sessionSettings.read_only, 'on');
  const indexes = await prisma.$queryRawUnsafe(`SELECT c.relname::text AS name, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname::text = ANY($1::text[]) ORDER BY c.relname`, names);
  assert.equal(indexes.length, 6);
  assert(indexes.every(row => row.valid));
  report.indexes = indexes;
  report.catalog = (await prisma.$queryRawUnsafe("SELECT count(*)::int AS index_count, count(*) FILTER (WHERE NOT i.indisvalid)::int AS invalid_index_count FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace"))[0];
  report.catalog.applied_migration_count = (await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL'))[0].count;
  report.counts = {};
  for (const table of ['parcels','parcel_status_history','settlements','settlement_items','notifications','locations']) {
    report.counts[table] = Number((await prisma.$queryRawUnsafe(`SELECT count(*)::bigint AS count FROM ${table}`))[0].count);
  }
  report.originalAuditCounts = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/database-audit/local-query-plans.json'), 'utf8')).counts;
  const vendor = await prisma.vendors.findFirst({ where: { deleted_at: null, status: 'active' }, select: { user_id: true, id: true } });
  const actors = [{ name: 'staff', actor: { id: '00000000-0000-4000-8000-000000000000', roles: ['super_admin'] } }];
  if (vendor) actors.push({ name: 'vendor', actor: { id: vendor.user_id, roles: ['vendor'] } });
  for (const { name, actor } of actors) {
    const scope = await getActorScope(actor);
    const where = buildOrdersWhere(scope, {});
    const full = await prisma.parcels.findMany({ where, include: beforeInclude, orderBy: [{ order_number: 'desc' }, { id: 'desc' }], take: 20 });
    const expected = full.map(row => mapOrder(row, name === 'staff', !!scope.vendorId));
    const result = await listOrders(actor, { page: 1, pageSize: 20 });
    assert.deepEqual(result.data, expected);
    assert.equal(result.meta.total, await prisma.parcels.count({ where }));
    report.checks.push({ name: `${name} full-versus-lean list DTO and exact totals`, passed: true, comparedRows: full.length });
    const dimensions = ['origin_location_id','destination_location_id','delivery_rider_id','pickup_rider_id'];
    const rows = await Promise.all(dimensions.map(dimension => prisma.parcels.findMany({ where, distinct: [dimension], include: beforeInclude })));
    const reference = {
      origins: rows[0].filter(row => row.origin_location_id && row.locations_parcels_origin_location_idTolocations?.name).map(row => ({ id: row.origin_location_id, name: row.locations_parcels_origin_location_idTolocations.name })),
      destinations: rows[1].filter(row => row.destination_location_id && row.locations_parcels_destination_location_idTolocations?.name).map(row => ({ id: row.destination_location_id, name: row.locations_parcels_destination_location_idTolocations.name })),
      riders: [...new Set([...rows[2].map(row => row.riders_parcels_delivery_rider_idToriders?.name), ...rows[3].map(row => row.riders_parcels_pickup_rider_idToriders?.name)].filter(Boolean))],
    };
    assert.deepEqual(normalizeOptions(await getOrderFilterOptions(actor)), normalizeOptions(reference));
    report.checks.push({ name: `${name} legacy DISTINCT-versus-grouped filter options`, passed: true });
  }
  if (vendor) {
    const other = await prisma.vendors.findFirst({ where: { id: { not: vendor.id } }, select: { id: true } });
    if (other) {
      const result = await listOrders({ id: vendor.user_id, roles: ['vendor'] }, { page: 1, vendorId: [other.id] });
      assert.equal(result.data.length, 0); assert.equal(result.meta.total, 0);
      report.checks.push({ name: 'Vendor cannot widen scope with another vendor filter', passed: true });
    }
  }
  const endCounts = {};
  for (const table of Object.keys(report.counts)) endCounts[table] = Number((await prisma.$queryRawUnsafe(`SELECT count(*)::bigint AS count FROM ${table}`))[0].count);
  assert.deepEqual(endCounts, report.counts);
  report.checks.push({ name: 'Business row counts unchanged during read-only verification', passed: true });
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error('Read-only verification failed:', error.code || error.name); process.exitCode = 1; }).finally(async () => {
  redis.disconnect(); await prisma.$disconnect(); await pool.end();
});
