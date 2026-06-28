import QRCode from 'qrcode';
import type { Order } from '../services/orders.service';

const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'DELIVERY',
  exchange: 'EXCHANGE',
  return: 'RETURN',
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });

function labelHtml(order: Order, qrDataUrl: string): string {
  const typeLabel = ORDER_TYPE_LABELS[order.orderType] ?? order.orderType.toUpperCase();
  const codLine = order.codAmount > 0 ? `NPR ${fmt(order.codAmount)}` : 'No COD';
  const weightLine = order.weightKg ? `${order.weightKg} kg` : '—';
  const pieces = order.pieces ?? 1;

  return `
<div class="label">
  <div class="label-header">
    <div class="brand">ParcelMoover</div>
    <div class="type-badge type-${order.orderType}">${typeLabel}</div>
  </div>

  <div class="label-body">
    <div class="parties">
      <div class="party">
        <span class="party-role">FROM</span>
        <span class="party-name">${esc(order.senderName)}</span>
        <span class="party-phone">${esc(order.senderPhone)}</span>
        <span class="party-hub">${esc(order.origin)}</span>
      </div>
      <div class="route-arrow">&#8594;</div>
      <div class="party">
        <span class="party-role">TO</span>
        <span class="party-name">${esc(order.receiverName)}</span>
        <span class="party-phone">${esc(order.receiverPhone)}</span>
        <span class="party-hub">${esc(order.destination)}</span>
      </div>
    </div>
    <div class="qr-block">
      <img src="${qrDataUrl}" alt="QR ${esc(order.trackingId)}" class="qr-img" />
    </div>
  </div>

  <div class="tracking-row">
    <span class="tracking-id">${esc(order.trackingId)}</span>
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
      <span class="footer-label">Pieces</span>
      <span class="footer-value">${pieces}</span>
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
    width: 105mm;
    min-height: 148mm;
    border: 1.5px solid #000;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    break-after: page;
    padding: 0;
    overflow: hidden;
  }

  .label-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1.5px solid #000;
    background: #1e293b;
    color: #fff;
  }

  .brand {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }

  .type-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .type-delivery  { background: #d1fae5; color: #065f46; }
  .type-return    { background: #fee2e2; color: #991b1b; }
  .type-exchange  { background: #fef3c7; color: #92400e; }

  .label-body {
    display: flex;
    flex: 1;
    gap: 0;
    padding: 10px;
    border-bottom: 1px dashed #999;
  }

  .parties {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    justify-content: space-around;
  }

  .route-arrow {
    font-size: 14px;
    color: #666;
    text-align: center;
  }

  .party {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .party-role {
    font-size: 8px;
    font-weight: 700;
    color: #666;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .party-name {
    font-size: 13px;
    font-weight: 700;
    color: #000;
    line-height: 1.2;
  }

  .party-phone {
    font-size: 11px;
    color: #333;
  }

  .party-hub {
    font-size: 10px;
    color: #555;
    font-weight: 600;
  }

  .qr-block {
    display: flex;
    align-items: center;
    justify-content: center;
    padding-left: 8px;
  }

  .qr-img {
    width: 80px;
    height: 80px;
    display: block;
  }

  .tracking-row {
    text-align: center;
    padding: 8px 10px;
    border-bottom: 1px dashed #999;
  }

  .tracking-id {
    font-size: 17px;
    font-weight: 900;
    letter-spacing: 2px;
    color: #000;
    font-family: 'Courier New', monospace;
  }

  .label-footer {
    display: flex;
    align-items: center;
    padding: 6px 10px;
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
    height: 28px;
    background: #ccc;
  }

  .footer-label {
    font-size: 8px;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .footer-value {
    font-size: 11px;
    font-weight: 700;
    color: #000;
  }

  @media print {
    @page {
      size: 105mm 148mm;
      margin: 0;
    }
    body { margin: 0; }
    .label { border: 1.5px solid #000; page-break-after: always; break-after: page; }
  }
`;

export async function printLabels(orders: Order[]): Promise<void> {
  if (orders.length === 0) return;

  const qrUrls = await Promise.all(
    orders.map((o) =>
      QRCode.toDataURL(o.trackingId, { width: 160, margin: 1, color: { dark: '#000000', light: '#ffffff' } }),
    ),
  );

  const labelsMarkup = orders.map((o, i) => labelHtml(o, qrUrls[i]!)).join('\n');

  const win = window.open('', '_blank', 'width=500,height=700');
  if (!win) {
    alert('Please allow popups for this site to print labels.');
    return;
  }

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Shipping Labels — ParcelMoover</title>
  <style>${CSS}</style>
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
