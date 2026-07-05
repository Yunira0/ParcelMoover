import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type { Order } from '../services/orders.service';

const WEBSITE_URL = 'www.parcelmoover.com';

const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'DELIVERY',
  exchange: 'EXCHANGE',
  return: 'RETURN',
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });

function barcodeDataUrl(trackingId: string): string {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, trackingId, {
    format: 'CODE128',
    displayValue: false,
    margin: 0,
    height: 40,
    width: 2,
  });
  return canvas.toDataURL('image/png');
}

function labelHtml(order: Order, qrDataUrl: string, barcodeUrl: string): string {
  const typeLabel = ORDER_TYPE_LABELS[order.orderType] ?? order.orderType.toUpperCase();
  const codLine = order.codAmount > 0 ? `NPR ${fmt(order.codAmount)}` : 'No COD';
  const weightLine = order.weightKg ? `${order.weightKg} kg` : '—';
  const packageLine = order.packageType || '—';

  return `
<div class="label">
  <div class="label-header">
    <div class="brand-block">
      <div class="brand">ParcelMoover</div>
      <div class="website">${esc(WEBSITE_URL)}</div>
    </div>
    <div class="type-badge type-${order.orderType}">${typeLabel}</div>
  </div>

  <div class="meta-row">
    <span class="meta-item">Order #${esc(String(order.orderNumber))}</span>
    <span class="tracking-id">${esc(order.trackingId)}</span>
  </div>

  <div class="route-row">
    <span class="route-hub">${esc(order.origin)}</span>
    <span class="route-arrow">&#8594;</span>
    <span class="route-hub">${esc(order.destination)}</span>
  </div>

  <div class="label-main">
    <div class="parties">
      <div class="party">
        <span class="party-role">From</span>
        <span class="party-name">${esc(order.senderName)}</span>
      </div>
      <div class="party-divider"></div>
      <div class="party">
        <span class="party-role">To</span>
        <span class="party-name">${esc(order.receiverName)}</span>
        <span class="party-phone">${esc(order.receiverPhone)}</span>
      </div>
    </div>
    <div class="code-block">
      <img src="${qrDataUrl}" alt="QR ${esc(order.trackingId)}" class="qr-img" />
      <img src="${barcodeUrl}" alt="Barcode ${esc(order.trackingId)}" class="barcode-img" />
    </div>
  </div>

  <div class="instruction-row">
    <span class="instruction-label">Note:</span>
    <span class="instruction-text">${esc(order.deliveryInstruction || 'None')}</span>
  </div>

  <div class="label-footer">
    <div class="footer-item">
      <span class="footer-label">COD</span>
      <span class="footer-value">${codLine}</span>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-item">
      <span class="footer-label">Weight</span>
      <span class="footer-value">${weightLine}</span>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-item">
      <span class="footer-label">Package</span>
      <span class="footer-value">${esc(packageLine)}</span>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-item">
      <span class="footer-label">Date</span>
      <span class="footer-value">${fmtDate(order.createdAt)}</span>
    </div>
  </div>
</div>`;
}

function esc(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; font-family: Arial, sans-serif; }

  .label {
    width: 100mm;
    height: 75mm;
    border: 1px solid #000;
    display: flex;
    flex-direction: column;
    padding: 3mm;
    overflow: hidden;
  }

  .label-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 4px;
    padding-bottom: 1.5mm;
    border-bottom: 1px solid #000;
  }

  .brand-block {
    display: flex;
    flex-direction: column;
    gap: 0.5px;
  }

  .brand {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .website {
    font-size: 7px;
    color: #555;
    letter-spacing: 0.2px;
  }

  .type-badge {
    font-size: 8px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 8px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .type-delivery  { background: #d1fae5; color: #065f46; }
  .type-return    { background: #fee2e2; color: #991b1b; }
  .type-exchange  { background: #fef3c7; color: #92400e; }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5mm 0;
    border-bottom: 1px dashed #999;
  }

  .meta-item {
    font-size: 9px;
    font-weight: 700;
    color: #333;
  }

  .tracking-id {
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 1px;
    font-family: 'Courier New', monospace;
  }

  .route-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 1.5mm 0;
    border-bottom: 1px solid #000;
  }

  .route-hub {
    font-size: 10px;
    font-weight: 700;
    color: #000;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 38mm;
  }

  .route-arrow {
    font-size: 10px;
    color: #666;
  }

  .label-main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 3mm;
    padding: 1.5mm 0;
  }

  .parties {
    flex: 1;
    display: flex;
    align-items: stretch;
    gap: 3mm;
    min-width: 0;
  }

  .party {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    min-width: 0;
  }

  .party-divider {
    width: 1px;
    background: #ccc;
  }

  .party-role {
    font-size: 7px;
    font-weight: 700;
    color: #666;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .party-name {
    font-size: 12px;
    font-weight: 700;
    color: #000;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .party-phone {
    font-size: 10px;
    color: #333;
  }

  .code-block {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5mm;
    padding-left: 3mm;
    border-left: 1px solid #000;
  }

  .qr-img {
    width: 18mm;
    height: 18mm;
    display: block;
  }

  .barcode-img {
    width: 20mm;
    height: 7mm;
    display: block;
  }

  .instruction-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    padding: 1.5mm 0;
    border-top: 1px dashed #999;
    overflow: hidden;
  }

  .instruction-label {
    font-size: 8px;
    font-weight: 700;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .instruction-text {
    font-size: 9px;
    color: #333;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label-footer {
    display: flex;
    align-items: center;
    padding-top: 2mm;
    border-top: 1px solid #000;
    gap: 0;
  }

  .footer-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .footer-divider {
    width: 1px;
    height: 18px;
    background: #ccc;
  }

  .footer-label {
    font-size: 7px;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .footer-value {
    font-size: 10px;
    font-weight: 700;
    color: #000;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media print {
    body { margin: 0; }
    .label { border: 1px solid #000; }
  }
`;

// One continuous strip the height of every label stacked back-to-back, so a
// roll printer feeds them one after another with no blank gap or forced cut
// between labels - the physical media (die-cut roll or manual tear) handles
// separation, not a CSS page break per label.
function printMediaCss(labelCount: number): string {
  return `
  @media print {
    @page {
      size: 100mm ${labelCount * 75}mm;
      margin: 0;
    }
  }
`;
}

export async function printLabels(orders: Order[]): Promise<void> {
  if (orders.length === 0) return;

  // Open the window synchronously, still inside the click's call stack -
  // popup blockers (Safari especially) kill window.open() called after an
  // await, even a fast one, so this can't wait for the QR/barcode data first.
  const win = window.open('', '_blank', 'width=480,height=420');
  if (!win) {
    alert('Please allow popups for this site to print labels.');
    return;
  }
  win.document.write('<!DOCTYPE html><title>Preparing labels…</title><body style="font-family:Arial,sans-serif;padding:24px;color:#555;">Preparing labels…</body>');

  const qrUrls = await Promise.all(
    orders.map((o) =>
      QRCode.toDataURL(o.trackingId, { width: 240, margin: 1, color: { dark: '#000000', light: '#ffffff' } }),
    ),
  );
  const barcodeUrls = orders.map((o) => barcodeDataUrl(o.trackingId));

  const labelsMarkup = orders.map((o, i) => labelHtml(o, qrUrls[i]!, barcodeUrls[i]!)).join('\n');

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Shipping Labels — ParcelMoover</title>
  <style>${CSS}${printMediaCss(orders.length)}</style>
</head>
<body>
${labelsMarkup}
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
