// Disposable synthetic PostgreSQL fixture. Never reads DATABASE_URL.
// Run from server/: node scripts/benchmark-database-indexes.cjs [output.json]
const { PGlite } = require('@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function measure(db, sql, values) {
  const results = await db.query(sql, values);
  const samples = [];
  let plan;
  for (let i = 0; i < 4; i++) {
    plan = (await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, values)).rows[0]['QUERY PLAN'][0];
    samples.push(plan['Execution Time']);
  }
  samples.sort((a,b) => a-b);
  return { rows: results.rows, medianMs: Number(((samples[1]+samples[2])/2).toFixed(3)), plan };
}

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE parcel_status AS ENUM ('picked_up','delivered','returned_to_vendor');
      CREATE TABLE parcels (id integer PRIMARY KEY, vendor_id integer, order_number integer, deleted_at timestamptz);
      INSERT INTO parcels SELECT n,n%1000,n,NULL FROM generate_series(1,200000) n;
      CREATE INDEX idx_parcels_vendor_id ON parcels(vendor_id);
      CREATE INDEX idx_parcels_order_number_id ON parcels(order_number DESC,id DESC);
      CREATE TABLE parcel_status_history (id integer PRIMARY KEY,parcel_id integer,new_status parcel_status,created_at timestamptz);
      INSERT INTO parcel_status_history
        SELECT n,1+(n%200000),CASE WHEN n%100=0 THEN 'returned_to_vendor'::parcel_status ELSE 'picked_up'::parcel_status END,
        timestamptz '2026-10-06 00:00:00+05:45' - ((n%731)||' days')::interval FROM generate_series(1,600000) n;
      CREATE INDEX idx_parcel_status_history_parcel_id ON parcel_status_history(parcel_id,created_at DESC);
      CREATE TABLE settlement_items (settlement_id integer,cod_collection_id integer,PRIMARY KEY(settlement_id,cod_collection_id));
      INSERT INTO settlement_items SELECT n/10,n FROM generate_series(1,250000) n;
      CREATE TABLE settlements (id integer PRIMARY KEY,vendor_id integer,rider_id integer,payee_type text,created_at timestamptz);
      INSERT INTO settlements SELECT n,CASE WHEN n%2=0 THEN n%1000 END,CASE WHEN n%2=1 THEN n%1000 END,
        CASE WHEN n%2=0 THEN 'vendor' ELSE 'rider' END,
        timestamptz '2026-10-06 00:00:00+05:45' - ((n%731)||' days')::interval FROM generate_series(1,50000) n;
      CREATE TABLE notifications (id integer PRIMARY KEY,user_id integer,created_at timestamptz,read_at timestamptz);
      INSERT INTO notifications SELECT n,n%1000,timestamptz '2026-10-06 00:00:00+05:45' - ((n%731)||' days')::interval,NULL FROM generate_series(1,100000) n;
      CREATE INDEX idx_notifications_user_read ON notifications(user_id,read_at);
      ANALYZE;
    `);
    const scenarios = [
      { name: 'vendorOrderPage', before: 'SELECT id,order_number FROM parcels WHERE vendor_id=$1 AND deleted_at IS NULL ORDER BY order_number DESC,id DESC LIMIT 21', values: [1], index: 'CREATE INDEX candidate_vendor_order ON parcels(vendor_id,order_number DESC,id DESC)' },
      { name: 'returnHistory', before: "SELECT count(DISTINCT h.parcel_id) FROM parcel_status_history h JOIN parcels p ON p.id=h.parcel_id WHERE h.new_status::text='returned_to_vendor' AND h.created_at >= $1::timestamptz AND p.deleted_at IS NULL", after: "SELECT count(DISTINCT h.parcel_id) FROM parcel_status_history h JOIN parcels p ON p.id=h.parcel_id WHERE h.new_status='returned_to_vendor'::parcel_status AND h.created_at >= $1::timestamptz AND p.deleted_at IS NULL", values: ['2026-09-30T00:00:00+05:45'], index: 'CREATE INDEX candidate_status_date ON parcel_status_history(new_status,created_at,parcel_id)' },
      { name: 'reverseSettlementLookup', before: 'SELECT settlement_id FROM settlement_items WHERE cod_collection_id=$1 ORDER BY settlement_id', values: [100001], index: 'CREATE INDEX candidate_collection_settlement ON settlement_items(cod_collection_id,settlement_id)' },
      { name: 'vendorSettlementPage', before: "SELECT id FROM settlements WHERE vendor_id=$1 AND payee_type='vendor' ORDER BY created_at DESC,id DESC LIMIT 21", values: [2], index: 'CREATE INDEX candidate_vendor_settlement ON settlements(vendor_id,created_at DESC,id DESC)' },
      { name: 'riderSettlementPage', before: "SELECT id FROM settlements WHERE rider_id=$1 AND payee_type='rider' ORDER BY created_at DESC,id DESC LIMIT 21", values: [1], index: 'CREATE INDEX candidate_rider_settlement ON settlements(rider_id,created_at DESC,id DESC)' },
      { name: 'notificationFeed', before: 'SELECT id FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET 20', values: [1], index: 'CREATE INDEX candidate_notification_feed ON notifications(user_id,created_at DESC,id DESC)' },
    ];
    const report = { capturedAt: new Date().toISOString(), fixture: { parcels: 200000, vendors: 1000, history: 600000, settlementItems: 250000, settlements: 50000, notifications: 100000, sqlSamplesPerVariant: 4, data: 'Synthetic integer identities, simplified tables, in-memory PGlite. Non-concurrent index builds. Timing is query execution only; warm-run median, not production performance.' }, scenarios: [] };
    for (const s of scenarios) {
      const before = await measure(db,s.before,s.values);
      await db.exec(s.index);
      await db.exec('ANALYZE');
      const after = await measure(db,s.after || s.before,s.values);
      assert.deepEqual(after.rows,before.rows);
      report.scenarios.push({ name: s.name,beforeMs: before.medianMs,afterMs: after.medianMs,resultsMatch: true,returnedRows: after.rows.length,beforeSql: s.before,afterSql: s.after||s.before,indexSql:s.index,beforePlan:before.plan,afterPlan:after.plan });
    }
    if (process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({ fixture: report.fixture, scenarios: report.scenarios.map(({name,beforeMs,afterMs,resultsMatch})=>({name,beforeMs,afterMs,resultsMatch})) },null,2));
  } finally { await db.close(); }
}
main().catch(error=>{ console.error(error);process.exitCode=1; });
