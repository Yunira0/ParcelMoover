import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));
const sizes = new Map();

function resources(entries) {
  const seen = new Set();
  const files = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Missing production manifest entry: ${key}`);
    seen.add(key);
    files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
    for (const dependency of entry.imports ?? []) visit(dependency);
  }
  entries.forEach(visit);
  return files;
}

function gzipBytes(files, extension) {
  let total = 0;
  for (const file of files) {
    if (!file.endsWith(extension)) continue;
    if (!sizes.has(file)) sizes.set(file, gzipSync(readFileSync(new URL(file, dist))).length);
    total += sizes.get(file);
  }
  return total;
}

const shell = ['index.html', 'src/layouts/DashboardLayout.tsx'];
const warmed = resources(shell);
const publicPages = new Set(['Login', 'TrackParcel', 'KycApplicationPage', 'ForceChangePasswordPage']);
const pages = Object.keys(manifest).filter((key) => /^src\/pages\/.*\.tsx$/.test(key) && manifest[key].isDynamicEntry);
const report = [{ page: 'Home', coldJsKb: gzipBytes(resources(['index.html']), '.js') / 1000, coldCssKb: gzipBytes(resources(['index.html']), '.css') / 1000 }];
for (const entry of pages.sort()) {
  const name = entry.split('/').at(-1).replace('.tsx', '');
  const entries = [...(publicPages.has(name) ? ['index.html'] : shell), entry];
  if (['Dashboard', 'VendorDashboard', 'SalesDashboard'].includes(name)) entries.push('src/pages/DashboardRouter.tsx');
  if (['OrderManagement', 'VendorOrders'].includes(name)) entries.push('src/pages/OrdersRouter.tsx');
  const files = resources(entries);
  report.push({
    page: entry.slice('src/pages/'.length).replace('.tsx', ''),
    coldJsKb: gzipBytes(files, '.js') / 1000,
    coldCssKb: gzipBytes(files, '.css') / 1000,
    extraJsKbAfterShell: publicPages.has(name) ? null : gzipBytes(new Set([...files].filter((file) => !warmed.has(file))), '.js') / 1000,
    jsRequests: [...files].filter((file) => file.endsWith('.js')).length,
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('| Page | Cold JS, gzip kB | Cold CSS, gzip kB | Extra JS after shell, kB | JS files |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const row of report) console.log(`| ${row.page} | ${row.coldJsKb.toFixed(1)} | ${row.coldCssKb.toFixed(1)} | ${row.extraJsKbAfterShell?.toFixed(1) ?? '—'} | ${row.jsRequests ?? '—'} |`);
}
