import type { ParcelStatus, RunSheet } from '../services/orders.service';
import { toBsDate, toNptTime } from './nepaliDate';

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function esc(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; color: #000; font-family: Arial, sans-serif; padding: 10mm; }

  .sheet-header {
    align-items: flex-start;
    border-bottom: 2px solid #000;
    display: flex;
    justify-content: space-between;
    padding-bottom: 4mm;
  }

  .brand { font-size: 18px; font-weight: 800; letter-spacing: 0.3px; }
  .doc-title { color: #444; font-size: 11px; letter-spacing: 1px; margin-top: 2px; text-transform: uppercase; }
  .sheet-no { font-family: 'Courier New', monospace; font-size: 16px; font-weight: 900; letter-spacing: 1px; text-align: right; }
  .sheet-date { color: #444; font-size: 10px; margin-top: 2px; text-align: right; }

  .meta-grid {
    border-bottom: 1px solid #000;
    display: flex;
    flex-wrap: wrap;
    gap: 3mm 8mm;
    padding: 3mm 0;
  }

  .meta-item { min-width: 30mm; }
  .meta-label { color: #666; font-size: 8px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
  .meta-value { font-size: 11px; font-weight: 700; margin-top: 1px; }

  table { border-collapse: collapse; margin-top: 4mm; width: 100%; }
  th, td { border: 1px solid #000; font-size: 9px; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 8px; letter-spacing: 0.4px; text-transform: uppercase; }
  td.num { text-align: right; white-space: nowrap; }
  td.mono { font-family: 'Courier New', monospace; font-weight: 700; white-space: nowrap; }
  td small { color: #444; display: block; font-size: 8px; margin-top: 1px; }
  td.sign { min-width: 22mm; }
  tr { break-inside: avoid; }

  tfoot td { background: #eee; font-weight: 700; }

  .signatures {
    display: flex;
    gap: 16mm;
    justify-content: space-between;
    margin-top: 14mm;
  }

  .signature { border-top: 1px solid #000; flex: 1; font-size: 9px; padding-top: 2mm; text-align: center; text-transform: uppercase; }

  @media print {
    @page { size: A4 portrait; margin: 8mm; }
    body { padding: 0; }
  }
`;

/** Opens a print window with a field-ready document for one run sheet. */
export function printRunSheet(
  sheet: RunSheet,
  statusLabels: Record<ParcelStatus, string>,
): void {
  const win = window.open('', '_blank', 'width=900,height=650');
  if (!win) {
    alert('Please allow popups for this site to print the run sheet.');
    return;
  }

  const rows = sheet.parcels
    .map(
      (parcel, index) => `
    <tr>
      <td class="num">${index + 1}</td>
      <td class="mono">${esc(parcel.trackingId)}</td>
      <td>${esc(parcel.receiverName)}<small>${esc(parcel.receiverPhone)}</small></td>
      <td>${esc(parcel.address || parcel.destination || '-')}</td>
      <td class="num">${parcel.pieces}</td>
      <td class="num">${parcel.codAmount > 0 ? fmt(parcel.codAmount) : '-'}</td>
      <td>${esc(parcel.vendorName || '-')}</td>
      <td>${esc(statusLabels[parcel.status] ?? parcel.status)}</td>
      <td class="sign"></td>
    </tr>`,
    )
    .join('');

  const metaItems: [string, string][] = [
    ['Rider', sheet.rider.name],
    ['Phone', sheet.rider.phone || '-'],
    ['Vehicle', sheet.rider.vehicleNo || '-'],
    ['Hub', sheet.rider.hub || '-'],
    ['Total Items', String(sheet.totalItems)],
    ['Delivered', String(sheet.deliveredItems)],
    ['Failed', String(sheet.failedItems)],
    ['Total COD', `NPR ${fmt(sheet.totalCod)}`],
  ];

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Run Sheet ${esc(sheet.sheetNo)} — ParcelMoover</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="sheet-header">
    <div>
      <div class="brand">ParcelMoover</div>
      <div class="doc-title">Rider Run Sheet</div>
    </div>
    <div>
      <div class="sheet-no">${esc(sheet.sheetNo)}</div>
      <div class="sheet-date">${esc(toBsDate(sheet.createdAt))} · ${esc(toNptTime(sheet.createdAt, true))}</div>
    </div>
  </header>

  <div class="meta-grid">
    ${metaItems
      .map(
        ([label, value]) => `
    <div class="meta-item">
      <div class="meta-label">${esc(label)}</div>
      <div class="meta-value">${esc(value)}</div>
    </div>`,
      )
      .join('')}
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Tracking ID</th>
        <th>Receiver</th>
        <th>Delivery Address</th>
        <th>Pcs</th>
        <th>COD</th>
        <th>Vendor</th>
        <th>Status</th>
        <th>Signature</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">Totals</td>
        <td class="num">${sheet.parcels.reduce((sum, p) => sum + p.pieces, 0)}</td>
        <td class="num">${fmt(sheet.totalCod)}</td>
        <td colspan="3">${sheet.totalItems} parcel${sheet.totalItems === 1 ? '' : 's'}</td>
      </tr>
    </tfoot>
  </table>

  <div class="signatures">
    <div class="signature">Prepared By</div>
    <div class="signature">Rider (${esc(sheet.rider.name)})</div>
    <div class="signature">Verified By</div>
  </div>

<script>
  window.addEventListener('load', function() {
    window.print();
    window.addEventListener('afterprint', function() { window.close(); });
  });
<\/script>
</body>
</html>`);
  win.document.close();
}
