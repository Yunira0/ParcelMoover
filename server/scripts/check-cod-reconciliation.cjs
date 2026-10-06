const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require(process.env.COD_REVIEW_TYPESCRIPT_PATH || 'typescript');

// Execute the actual private helper without loading application clients or
// connecting to a database. TypeScript's parser selects its source boundary.
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/services/order.service.ts'), 'utf8');
const ast = ts.createSourceFile('order.service.ts', source, ts.ScriptTarget.Latest, true);
const helper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reconcileCodCollectionOnStatusChange');
const statuses = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'COD_COLLECTED_STATUSES'));
assert(helper && statuses, 'COD reconciliation helper and its collected-status set must exist');
const errorExports = {};
const errorCode = ts.transpileModule(fs.readFileSync(path.join(root, 'src/utils/AppError.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(errorCode, { exports: errorExports });
const code = ts.transpileModule(statuses.getText(ast) + '\n' + helper.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = vm.createContext({ AppError: errorExports.AppError });
vm.runInContext(code, context);
const reconcile = context.reconcileCodCollectionOnStatusChange;

function fixture(settled) {
  const row = { collected_amount: 1500, collected_at: new Date('2026-08-01'), payment_status: settled ? 'paid' : 'pending', remitted_amount: settled ? 1500 : 0, rider_remitted_amount: 1500, rider_payment_status: 'paid', rider_settled_at: new Date('2026-08-01'), settlement_items: settled ? [{ settlements: { statement_id: 'STM-1', payee_type: 'rider', status: 'settled' } }] : [] };
  const before = structuredClone(row);
  const writes = [];
  const tx = { $queryRaw: async () => [], cod_collections: {
    findUnique: async () => row,
    update: async ({ data }) => { writes.push(data); Object.assign(row, data); },
  }};
  return { row, before, writes, tx };
}

for (const next of ['follow_up', 'ready_to_return', 'ready_to_deliver']) {
  for (const settled of [false, true]) {
    test(`partial delivery -> ${next} preserves ${settled ? 'settled' : 'unsettled'} cash`, async () => {
      const f = fixture(settled);
      await reconcile(f.tx, 'parcel', 'partially_delivered', next);
      assert.equal(f.writes.length, 0);
      assert.deepEqual(f.row, f.before);
    });
  }
}
test('reversing an unsettled completed delivery still resets its collection', async () => {
  const f = fixture(false);
  await reconcile(f.tx, 'parcel', 'delivered', 'follow_up');
  assert.equal(f.writes.length, 1);
  assert.equal(f.row.collected_amount, 0);
  assert.equal(f.row.collected_at, null);
});
test('reversing a settled completed delivery still refuses before writing', async () => {
  const f = fixture(true);
  await assert.rejects(reconcile(f.tx, 'parcel', 'delivered', 'follow_up'), { statusCode: 409 });
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.row, f.before);
});
test('replacing a settled partial collection with a full collection stays blocked', async () => {
  const f = fixture(true);
  await assert.rejects(reconcile(f.tx, 'parcel', 'partially_delivered', 'delivered'), { statusCode: 409 });
  assert.deepEqual(f.row, f.before);
});
