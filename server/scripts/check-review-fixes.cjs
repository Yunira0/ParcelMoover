const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test, after } = require('node:test');

// Historical worktrees may use the active checkout's installed test tools.
// Application database clients and real document files are never loaded.
const root = path.resolve(__dirname, '..');
const dependencies = createRequire(process.env.REVIEW_DEPENDENCIES_FROM || path.join(root, 'package.json'));
const ts = dependencies('typescript');
const { PGlite } = dependencies('@electric-sql/pglite');
const runtime = dependencies('@prisma/client/runtime/client');
const Prisma = { sql: runtime.sqltag, empty: runtime.empty };
const { z } = dependencies('zod');

function declarations(file, names) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return names.map(name => {
    const node = ast.statements.find(n =>
      (ts.isFunctionDeclaration(n) && n.name?.text === name) ||
      (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === name)) ||
      (ts.isClassDeclaration(n) && n.name?.text === name));
    assert(node, `Missing source declaration: ${name}`);
    return node.getText(ast);
  }).join('\n');
}

function evaluate(source, globals = {}) {
  const context = vm.createContext({ exports: {}, Date, ...globals });
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context;
}
const AppError = evaluate(declarations('src/utils/AppError.ts', ['AppError'])).exports.AppError;
const retentionSource = declarations('src/services/kyc.service.ts', [
  'releaseRejectedDocument', 'REJECTED_DOCUMENT_RETENTION_DAYS', 'purgeExpiredRejectedKycDocuments',
]);
const modernKyc = fs.readFileSync(path.join(root, 'src/services/kyc.service.ts'), 'utf8').includes('citizenship_doc_front');
const frontField = modernKyc ? 'citizenship_doc_front' : 'citizenship_doc';
const fields = modernKyc ? [frontField, 'citizenship_doc_back', 'pan_vat_doc', 'business_cert_doc'] : [frontField, 'pan_vat_doc', 'business_cert_doc'];
const vendorField = field => field === 'citizenship_doc_front' ? 'citizenship_doc' : field;
function retentionFixture(field = frontField, { vendor = false, application = false, checkError, unlinkError } = {}) {
  const doc = 'uploads/registration/existing.pdf';
  const row = { id: 'rejected', ...Object.fromEntries(fields.map(field => [field, null])), [field]: doc };
  const removed = [], updates = [], audits = [];
  const prisma = {
    vendors: { findFirst: async args => {
      assert.equal(args.where.OR.some(p => p[vendorField(field)] === doc), true);
      if (checkError) throw checkError;
      return vendor ? { id: 'living-vendor' } : null;
    } },
    vendor_kyc_applications: {
      findMany: async args => {
        assert.equal(args.where.status, 'rejected');
        assert.equal(Date.now() - args.where.reviewed_at.lt.getTime() >= 30 * 86400000, true);
        return [row];
      },
      findFirst: async args => {
        assert.equal(args.where.id.not, row.id);
        assert.equal(args.where.OR.some(p => p[field] === doc), true);
        return application ? { id: 'other-application' } : null;
      },
      update: async args => updates.push(args),
    },
    audit_logs: { create: async args => audits.push(args) },
    $transaction: async fn => fn(prisma),
  };
  const context = evaluate(retentionSource, {
    prisma, path, process: { cwd: () => '/fixture' }, console: { error: () => {} },
    unlink: async file => { removed.push(file); if (unlinkError) throw unlinkError; },
  });
  return { purge: context.exports.purgeExpiredRejectedKycDocuments, removed, updates, audits, doc };
}
for (const field of fields) {
  test(`vendor's shared ${field} survives rejected-document cleanup`, async () => {
    const f = retentionFixture(field, { vendor: true });
    const result = await f.purge();
    assert.equal(result.purged, 1);
    assert.equal(f.removed.length, 0);
    assert.equal(f.updates[0].data[field], null);
  });
}
test('another application keeps its shared document', async () => {
  const f = retentionFixture('pan_vat_doc', { application: true });
  await f.purge();
  assert.equal(f.removed.length, 0);
  assert.equal(f.updates.length, 1);
});
test('an unshared expired document is removed and audited', async () => {
  const f = retentionFixture();
  await f.purge();
  assert.equal(f.removed[0], '/fixture/' + f.doc);
  assert.equal(f.updates.length, 1);
  assert.equal(f.audits[0].data.action, 'KYC_PURGE_DOCUMENTS');
});
test('failed reference checks cannot delete documents or clear references', async () => {
  const f = retentionFixture(frontField, { checkError: new Error('Unavailable') });
  await assert.rejects(f.purge(), /Unavailable/);
  assert.equal(f.removed.length, 0);
  assert.equal(f.updates.length, 0);
});
test('failed filesystem deletion preserves a reference for retry', async () => {
  const f = retentionFixture('business_cert_doc', { unlinkError: { code: 'EACCES' } });
  assert.equal((await f.purge()).purged, 0);
  assert.equal(f.updates.length, 0);
});
test('already missing unshared files can finish cleanup', async () => {
  const f = retentionFixture('pan_vat_doc', { unlinkError: { code: 'ENOENT' } });
  assert.equal((await f.purge()).purged, 1);
  assert.equal(f.updates.length, 1);
});

const campaignSource = declarations('src/services/voucher-campaign.service.ts', [
  'requireStaff', 'toCodeState', 'listCampaignCodes', 'campaignCodesCsv',
]);
const sqlDb = new PGlite();
after(() => sqlDb.close());
const campaignId = '11111111-1111-4111-8111-111111111111';
const admin = { id: 'staff', roles: ['admin'] };
const ready = (async () => {
  await sqlDb.exec(`
    CREATE TABLE vouchers (id text, code text, title text, description text, is_active boolean, expires_at timestamptz, campaign_id uuid);
    CREATE TABLE voucher_claims (id text, voucher_id text, vendor_id text, state text, claimed_at timestamptz);
    CREATE TABLE vendors (id text, business_name text, client_name text);
    INSERT INTO vendors VALUES ('vendor', 'Fixture shop', 'Owner');
  `);
  let n = 0;
  for (const active of [true, false]) for (const expires of ['2000-01-01', '2100-01-01']) for (const claim of [null, 'claimed', 'reserved', 'used']) {
    const id = `code-${++n}`;
    await sqlDb.query("INSERT INTO vouchers VALUES ($1,$1,'Title','Description',$2,$3,$4)", [id, active, expires, campaignId]);
    if (claim) await sqlDb.query("INSERT INTO voucher_claims VALUES ($1,$1,'vendor',$2,now())", [id, claim]);
  }
})();
const campaignDb = {
  voucher_campaigns: { findUnique: async () => ({ id: campaignId, code_prefix: 'TEST' }) },
  $queryRaw: async (strings, ...values) => {
    await ready;
    const query = Prisma.sql(strings, ...values);
    const result = await sqlDb.query(query.text, query.values);
    return result.rows.map(row => ({
      ...row,
      ...(row.expires_at ? { expires_at: new Date(row.expires_at) } : {}),
      ...(row.claimed_at ? { claimed_at: new Date(row.claimed_at) } : {}),
    }));
  },
};
const campaigns = evaluate(campaignSource, { prisma: campaignDb, Prisma, z, AppError }).exports;
for (const [state, count] of [['paused', 8], ['unclaimed', 1], ['expired', 1], ['claimed', 4], ['redeemed', 2], ['all', 16]]) {
  test(`voucher ${state} filter returns the matching states and exact total`, async () => {
    const result = await campaigns.listCampaignCodes(admin, campaignId, { state });
    assert.equal(result.total, count);
    assert.equal(result.data.length, count);
    if (state !== 'all') assert.equal(result.data.every(row => row.state === state), true);
  });
}
test('voucher filters remain staff-only', async () => {
  await assert.rejects(campaigns.listCampaignCodes({ roles: ['vendor'] }, campaignId), { statusCode: 403 });
});
test('voucher CSV keeps paused, expired and unclaimed states distinct', async () => {
  const { csv } = await campaigns.campaignCodesCsv(admin, campaignId);
  assert.equal(csv.split('\n').length, 17);
  assert.match(csv, /,paused,/);
  assert.match(csv, /,expired,/);
  assert.match(csv, /,unclaimed,/);
});
