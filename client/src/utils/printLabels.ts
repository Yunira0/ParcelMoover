import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type { Order } from '../services/orders.service';
import { toBsDate } from './nepaliDate';

const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'DELIVERY',
  exchange: 'EXCHANGE',
  return: 'RETURN',
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  delivery: { bg: '#fff', text: '#000' },
  exchange: { bg: '#fff', text: '#000' },
  return: { bg: '#fff', text: '#000' },
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtDate = (iso: string) => toBsDate(iso);

function barcodeDataUrl(trackingId: string): string {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, trackingId, {
    format: 'CODE128',
    displayValue: false,
    margin: 0,
    height: 55,
    width: 1.8,
  });
  return canvas.toDataURL('image/png');
}

function labelHtml(order: Order, qrDataUrl: string, barcodeUrl: string): string {
  const typeLabel = ORDER_TYPE_LABELS[order.orderType] ?? order.orderType.toUpperCase();
  const typeColor = TYPE_COLORS[order.orderType] ?? { bg: '#fff', text: '#000' };
  const codLine = order.codAmount > 0 ? `NPR ${fmt(order.codAmount)}` : '—';
  const weightLine = order.weightKg ? `${order.weightKg} kg` : '—';
  const packageLine = order.packageType || '—';
  let cleanDestination = (order.destinationName || order.destination || '')
    .replace(/^(inside\s+valley\s*[-–—]?\s*|outside\s+valley\s*[-–—]?\s*)/i, '')
    .trim();
  const destination = esc(cleanDestination || order.destinationName || order.destination);
  const valleyLabel = order.destinationValley === 'inside' ? 'Inside Valley' : '';
  const fullAddress = order.receiverAddress ? esc(order.receiverAddress) : '—';

  return `
<div class="label">
  <div class="hdr">
    <div class="brand">
      <div class="brand-name">ParcelMoover</div>
      <div class="brand-url">portal.parcelmoover.com</div>
    </div>
    <div class="badge" style="background:${typeColor.bg};color:${typeColor.text}">${typeLabel}</div>
  </div>

  <div class="track">
    <span class="order-num">Order #${esc(String(order.orderNumber))}</span>
    <span class="track-id">${esc(order.trackingId)}</span>
  </div>

  <div class="route">
    <span class="route-hub">${esc(order.origin)}</span>
    <span class="route-arrow">&rarr;</span>
    ${valleyLabel ? `<span class="route-valley">${valleyLabel}</span>` : ''}
    ${order.destinationValley !== 'inside' ? `<span class="route-hub">${destination}</span>` : ''}
  </div>

  <div class="body">
    <div class="from-col">
      <span class="party-label">FROM</span>
      <span class="party-name">${esc(order.senderName)}</span>
    </div>
    <div class="to-col">
      <span class="party-label">TO</span>
      <span class="party-name">${esc(order.receiverName)}</span>
      <span class="party-phone">${esc(order.receiverPhone)}</span>
      <span class="party-addr">${fullAddress}</span>
    </div>
    <div class="codes">
      <img src="${qrDataUrl}" class="qr" />
      <img src="${barcodeUrl}" class="bc" />
    </div>
  </div>

  ${order.deliveryInstruction ? `<div class="note"><span class="note-label">NOTE:</span> <span class="note-text">${esc(order.deliveryInstruction)}</span></div>` : ''}

  <div class="foot">
    <div class="fc"><span class="fk">COD</span><span class="fv">${codLine}</span></div>
    <div class="fc"><span class="fk">WEIGHT</span><span class="fv">${weightLine}</span></div>
    <div class="fc"><span class="fk">PACKAGE</span><span class="fv">${esc(packageLine)}</span></div>
    <div class="fc"><span class="fk">DATE</span><span class="fv">${fmtDate(order.createdAt)}</span></div>
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
*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif}

.label{
  width:100mm;height:75mm;
  border:2px solid #000;
  display:flex;flex-direction:column;
  padding:0;overflow:hidden;
  page-break-after:always;break-after:page;
  background:#fff;
}

/* ── Header ── */
.hdr{
  display:flex;align-items:flex-start;justify-content:space-between;
  padding:2.5mm 3.5mm 2mm;
  border-bottom:2px solid #000;
}
.brand-name{font-size:15px;font-weight:800;color:#000;line-height:1.1}
.brand-url{font-size:8px;font-weight:700;color:#000;line-height:1.15;margin-top:0.2mm}
.badge{
  font-size:11px;font-weight:800;
  padding:1mm 3mm;
  border:1.5px solid #000;
  border-radius:2.5mm;
  text-transform:uppercase;letter-spacing:0.3px;
  white-space:nowrap;
}

/* ── Tracking ── */
.track{
  display:flex;align-items:baseline;justify-content:space-between;
  padding:2mm 3.5mm;
  border-bottom:1px dashed #000;
}
.order-num{font-size:10px;font-weight:700;color:#000}
.track-id{
  font-size:13px;font-weight:900;letter-spacing:0.8px;
  font-family:'Courier New',Consolas,monospace;
  color:#000;line-height:1.15;
  overflow-wrap:break-word;
  word-break:normal;
  text-align:right;
}

/* ── Route ── */
.route{
  display:flex;align-items:center;justify-content:center;
  padding:2mm 3.5mm;
  gap:3mm;
  border-bottom:2px solid #000;
}
.route-hub{
  font-size:12px;font-weight:800;color:#000;
  letter-spacing:0.5px;text-transform:uppercase;
  word-wrap:break-word;overflow-wrap:break-word;
  hyphens:auto;min-width:0;
}
.route-arrow{font-size:14px;color:#000;font-weight:700;flex-shrink:0}
.route-valley{
  font-size:9px;font-weight:700;color:#000;
  text-transform:uppercase;letter-spacing:0.3px;
  white-space:nowrap;flex-shrink:0;
}

/* ── Body ── */
.body{
  display:flex;flex:1;gap:0;
  padding:2mm 3.5mm;min-height:0;
  overflow:visible;
}
.from-col{
  flex:0 0 26%;display:flex;flex-direction:column;
  gap:0.3mm;min-width:0;
  padding-right:2.5mm;
  overflow:visible;
}
.to-col{
  flex:1;display:flex;flex-direction:column;
  gap:0.3mm;min-width:0;
  padding-left:2.5mm;
  border-left:1.5px solid #000;
  overflow:visible;
}
.party-label{
  font-size:6.5px;font-weight:700;color:#000;
  text-transform:uppercase;letter-spacing:1.2px;
  line-height:1;
}
.party-name{
  font-size:13px;font-weight:800;color:#000;
  line-height:1.2;word-wrap:break-word;overflow-wrap:break-word;
  hyphens:auto;
}
.party-phone{
  font-size:14px;font-weight:700;color:#000;
  font-family:'Courier New',Consolas,monospace;
  letter-spacing:0.5px;line-height:1.2;
}
.party-addr{
  font-size:12px;font-weight:700;color:#000;
  line-height:1.25;word-wrap:break-word;overflow-wrap:break-word;
  hyphens:auto;
  text-transform:uppercase;
}
.codes{
  flex-shrink:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:1.5mm;
  padding-left:2.5mm;border-left:1.5px solid #000;
}
.qr{width:18mm;height:18mm;display:block}
.bc{width:22mm;height:7mm;display:block}

/* ── Note ── */
.note{
  padding:1.5mm 3.5mm;
  border-top:1px dashed #000;
}
.note-label{font-size:9px;font-weight:700;color:#000}
.note-text{
  font-size:9px;font-weight:700;color:#000;font-style:italic;
  line-height:1.2;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;
}

/* ── Footer ── */
.foot{
  display:flex;align-items:stretch;
  padding:2mm 3.5mm;
  border-top:2px solid #000;
  gap:0;
}
.fc{
  flex:1;display:flex;flex-direction:column;
  align-items:center;gap:0;
  padding:0 1.5mm;
  border-right:1px solid #000;
}
.fc:last-child{border-right:none}
.fk{
  font-size:8px;color:#000;text-transform:uppercase;
  letter-spacing:0.5px;font-weight:700;line-height:1.1;
}
.fv{
  font-size:13px;font-weight:800;color:#000;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  max-width:100%;line-height:1.3;
}

@media print{
  body{margin:0}
  .label{border:2px solid #000}
  .label:not(:last-child){page-break-after:always;break-after:page}
}
`;

function printMediaCss(): string {
  return `
  @media print {
    @page {
      size: 100mm 75mm;
      margin: 0;
    }
  }
`;
}

export async function printLabels(orders: Order[]): Promise<void> {
  if (orders.length === 0) return;

  const win = window.open('', '_blank', 'width=480,height=420');
  if (!win) {
    alert('Please allow popups for this site to print labels.');
    return;
  }

  const qrUrls = await Promise.all(
    orders.map((o) =>
      QRCode.toDataURL(o.trackingId, { width: 260, margin: 1, color: { dark: '#000000', light: '#ffffff' } }),
    ),
  );
  const barcodeUrls = orders.map((o) => barcodeDataUrl(o.trackingId));

  const labelsMarkup = orders.map((o, i) => labelHtml(o, qrUrls[i]!, barcodeUrls[i]!)).join('\n');

  win.onload = () => {
    win.focus();
    win.print();
    win.addEventListener('afterprint', () => win.close());
  };

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Shipping Labels — ParcelMoover</title>
  <style>${CSS}${printMediaCss()}</style>
</head>
<body>
${labelsMarkup}
</body>
</html>`);
  win.document.close();
}
