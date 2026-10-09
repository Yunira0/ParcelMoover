import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));

// Dynamic imports are intentionally excluded: this is the code needed to
// open a page, including shared dependencies, before any optional action.
function importsFor(entries) {
  const keys = new Set();
  function visit(key) {
    if (keys.has(key)) return;
    assert.ok(manifest[key], `Missing build entry: ${key}`);
    keys.add(key);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  entries.forEach(visit);
  return keys;
}

const shell = ['index.html', 'src/layouts/DashboardLayout.tsx'];
const pages = [
  { name: 'Homepage', entries: ['index.html'], budget: 125_000 },
  { name: 'Admin dashboard', entries: [...shell, 'src/pages/DashboardRouter.tsx', 'src/pages/Dashboard.tsx'], budget: 165_000 },
  { name: 'Vendor dashboard', entries: [...shell, 'src/pages/DashboardRouter.tsx', 'src/pages/vendor/VendorDashboard.tsx'], budget: 165_000 },
  { name: 'Admin orders', entries: [...shell, 'src/pages/OrdersRouter.tsx', 'src/pages/OrderManagement.tsx'], budget: 205_000 },
  { name: 'Vendor orders', entries: [...shell, 'src/pages/OrdersRouter.tsx', 'src/pages/vendor/VendorOrders.tsx'], budget: 190_000 },
  { name: 'Vendor bulk orders', entries: [...shell, 'src/pages/vendor/BulkOrderPage.tsx'], budget: 170_000 },
  { name: 'Delivery rate settings', entries: [...shell, 'src/pages/DeliveryRateSettings.tsx'], budget: 175_000 },
  { name: 'Destinations import', entries: [...shell, 'src/pages/settings/DestinationsImport.tsx'], budget: 175_000 },
];

const startup = importsFor(['index.html']);
for (const deferred of ['src/layouts/DashboardLayout.tsx', 'src/pages/Login.tsx', 'src/pages/TrackParcel.tsx']) {
  assert.ok(!startup.has(deferred), `${deferred} must stay out of startup`);
}

for (const page of pages) {
  const keys = importsFor(page.entries);
  const files = [...keys].map((key) => manifest[key].file);
  assert.ok(!files.some((file) => /\/xlsx-.*\.js$/.test(file)), `${page.name} eagerly loads spreadsheets`);
  const bytes = files.reduce((total, file) => total + gzipSync(readFileSync(new URL(file, dist))).length, 0);
  assert.ok(bytes <= page.budget, `${page.name}: ${bytes} bytes exceeds ${page.budget}`);
  console.log(`${page.name}: ${(bytes / 1000).toFixed(1)} kB gzip (budget ${page.budget / 1000} kB)`);
}

for (const [router, choices] of [
  ['src/pages/DashboardRouter.tsx', ['src/pages/Dashboard.tsx', 'src/pages/vendor/VendorDashboard.tsx', 'src/pages/sales/SalesDashboard.tsx']],
  ['src/pages/OrdersRouter.tsx', ['src/pages/OrderManagement.tsx', 'src/pages/vendor/VendorOrders.tsx']],
]) {
  const imports = importsFor([router]);
  for (const choice of choices) {
    assert.ok(!imports.has(choice), `${router} eagerly loads ${choice}`);
    assert.ok(manifest[router].dynamicImports?.includes(choice), `${router} must retain ${choice}`);
  }
}

console.log(`Loading budgets and role splitting passed for ${fileURLToPath(dist)}`);
