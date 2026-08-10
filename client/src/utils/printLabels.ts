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
    // Rendered far above the printed size (see .bc) so scaling it down in CSS
    // never softens the bar edges - a blurry CODE128 is a scan failure.
    // `width` is the narrow-bar module width in px: the single biggest lever on
    // whether a printed barcode reads first time.
    height: 110,
    width: 4,
  });
  return canvas.toDataURL('image/png');
}

// The label's own hand-tuned design size - every font/QR/barcode/padding
// value below the .label-design rule is calibrated for exactly this box.
// Rather than re-deriving that tuning for every possible sticker size (the
// existing tuning already needed a follow-up fix once), a vendor's actual
// size is applied by uniformly scaling this whole design up or down - see
// the .label-frame/.label-design split and printLabels()'s transform below.
const DESIGN_WIDTH_MM = 100;
const DESIGN_HEIGHT_MM = 75;

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

  // A single uniform factor - scaling X and Y independently to force-fill a
  // frame with a different aspect ratio than the design (e.g. a vendor's
  // portrait 100x150mm stock vs. this design's 100x75mm) stretches every
  // font, the QR code, and the barcode out of proportion. Fitting the whole
  // design inside the frame at one scale and centering it (see .label-frame)
  // leaves margin on the frame's longer axis instead, which reads far better
  // than a warped, potentially unscannable label.
  const scale = Math.min(order.labelWidthMm / DESIGN_WIDTH_MM, order.labelHeightMm / DESIGN_HEIGHT_MM);

  return `
<div class="label-frame" style="width:${order.labelWidthMm}mm;height:${order.labelHeightMm}mm">
  <div class="label-design" style="transform:scale(${scale})">
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
.label-grid{
  display:flex;flex-wrap:wrap;gap:2mm;padding:0;
}

/* Sized per-order (inline style) to the vendor's own sticker size. Its only
   job is to clip to that size and carry the page-break; all visual design
   lives in .label-design at its native, hand-tuned size and is scaled to
   fit here - see labelHtml()'s scale transform. The page-break itself is set
   only in @media print below (and only for non-last frames), so screen
   rendering and the final label don't get a spurious trailing blank page. */
.label-frame{
  overflow:hidden;
  background:#fff;
}

/* Native, hand-tuned design size - never resized directly. Uniformly scaled
   by its parent .label-frame to whatever size the vendor actually needs
   (see labelHtml()'s uniform-scale comment). transform-origin:top left
   anchors the design to the frame's top-left corner, so on a mismatched
   aspect ratio (e.g. a portrait 4x6in sticker vs. this landscape design)
   any leftover blank space collects on the right/bottom edge only - the
   label prints immediately visible as it feeds out, instead of centering
   the content with blank margin split above/below it, which reads as a
   misprint rather than normal oversized stock. */
.label-design{
  width:100mm;height:75mm;
  border:2px solid #000;
  display:flex;flex-direction:column;
  padding:0;
  background:#fff;
  transform-origin:top left;
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
  body{margin:0;padding:0;background:#fff}
  /* Tile as many labels as fit on each physical sheet (A4 by default - see
     printMediaCss) instead of forcing one label per page, so a bulk print
     job doesn't burn a full page per sticker. break-inside:avoid keeps a
     single label from splitting across a page boundary; the browser inserts
     page breaks on its own once a row of labels would overflow. */
  .label-grid{
    display:flex;flex-wrap:wrap;gap:2mm;padding:0;
    justify-content:flex-start;align-content:flex-start;
  }
  .label-frame{
    page-break-inside:avoid;break-inside:avoid;
    margin:0;padding:0;
  }
}
`;

// The physical sheet the labels print onto. Bulk jobs (multiple orders) tile
// several labels per sheet on a standard A4 page via .label-grid above (see
// @media print). A single order, though, is the common "print label" button
// on one order - most vendors/branches feed that straight into a thermal
// sticker printer loaded with stock sized to exactly one label, so that case
// sizes @page to the label itself (0 margin) instead of A4: sizing a single
// label to A4 stranded it as a tiny printout in the corner of a mostly blank
// sheet. Each individual label still renders at its own vendor-configured
// size regardless (labelHtml's scale transform) - this only sets the sheet
// the browser prints onto, never what's visually drawn.
//
// @page is deliberately NOT nested inside @media print: @page is already
// print-only by spec, and some print engines only pick up a custom size
// declared at the stylesheet's top level.
function printMediaCss(orders: Order[]): string {
  if (orders.length === 1) {
    return `
  @page {
    size: ${orders[0]!.labelWidthMm}mm ${orders[0]!.labelHeightMm}mm;
    margin: 0;
  }
`;
  }
  return `
  @page {
    size: A4;
    margin: 5mm;
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
      // margin 0 drops the built-in 1-module quiet zone so the printed box is
      // entirely data - the spec's quiet zone is supplied by the surrounding
      // white space in .codes instead. Rendered at ~4x the printed size so
      // scaling it down in CSS never softens the modules.
      QRCode.toDataURL(o.trackingId, { width: 320, margin: 0, color: { dark: '#000000', light: '#ffffff' } }),
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
  <style>${CSS}${printMediaCss(orders)}</style>
</head>
<body>
<div class="label-grid">
${labelsMarkup}
</div>
<script>
  window.addEventListener('load', function() {
    window.focus();
    window.print();
    window.addEventListener('afterprint', function() { window.close(); });
  });
<\/script>
</body>
</html>`);
  win.document.close();
}
