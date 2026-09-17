import type { VoucherOffer } from '../services/voucher.service';
import { VOUCHER_ART_SRC, voucherFootnoteLeft, voucherFootnoteRight, voucherHeadline } from './voucherArt';

/**
 * Renders the voucher to a 1700x800 PNG (the Figma frame size) with
 * plain Canvas 2D — no extra dependencies, same-origin art so the canvas is
 * never tainted. Layout mirrors VoucherPromo.tsx; keep the two in sync.
 */

const W = 1700;
const H = 800;
const LEFT_W = 1202;
const ORANGE = '#f8600c';
const COPY_ORANGE = '#fd692d';
const INK = '#0a0a0c';

const ART_SRC = VOUCHER_ART_SRC;
const FONT = `Inter, system-ui, 'Segoe UI', Roboto, sans-serif`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Draw src cover-filling the target rect (same semantics as object-fit: cover). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
) {
  const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  // Fallback for browsers without CanvasRenderingContext2D.roundRect.
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * `copyPill: false` drops the COPY affordance — meaningless on paper.
 * `note` draws one instruction line under the code bar; print passes it because
 * a printed sheet has no HTML caption to lean on. Both default to the
 * on-screen look, so the preview and the PNG download are unaffected.
 */
export async function renderVoucherCanvas(
  offer: VoucherOffer,
  opts: { copyPill?: boolean; note?: string } = {},
): Promise<HTMLCanvasElement> {
  const [headA, headB] = voucherHeadline(offer);
  const art = await loadImage(ART_SRC);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');

  // Restrained charcoal panel with a warm tonal glow.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, LEFT_W, H);
  const panelGlow = ctx.createRadialGradient(950, 340, 10, 950, 340, 460);
  panelGlow.addColorStop(0, 'rgba(248, 96, 12, 0.13)');
  panelGlow.addColorStop(0.72, 'rgba(248, 96, 12, 0.025)');
  panelGlow.addColorStop(1, 'rgba(248, 96, 12, 0)');
  ctx.fillStyle = panelGlow;
  ctx.fillRect(0, 0, LEFT_W, H);

  // Tonal rings echo the sun in the artwork without competing with the copy.
  ctx.strokeStyle = 'rgba(248, 96, 12, 0.075)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(1015, 338, 215, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(248, 96, 12, 0.045)';
  ctx.beginPath();
  ctx.arc(1015, 338, 320, 0, Math.PI * 2);
  ctx.stroke();

  // Right art panel.
  drawCover(ctx, art, LEFT_W, 0, W - LEFT_W, H);
  const artFade = ctx.createLinearGradient(LEFT_W, 0, LEFT_W + 150, 0);
  artFade.addColorStop(0, 'rgba(9, 9, 11, 0.26)');
  artFade.addColorStop(1, 'rgba(9, 9, 11, 0)');
  ctx.fillStyle = artFade;
  ctx.fillRect(LEFT_W, 0, 150, H);
  ctx.strokeStyle = 'rgba(255, 124, 52, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LEFT_W + 0.5, 0);
  ctx.lineTo(LEFT_W + 0.5, H);
  ctx.stroke();

  // Brand row
  ctx.textBaseline = 'alphabetic';
  ctx.font = `750 32px ${FONT}`;
  const brandX = 84;
  const brandY = 78;
  ctx.fillStyle = '#ffffff';
  const parcelW = ctx.measureText('Parcel').width;
  ctx.fillText('Parcel', brandX, brandY);
  ctx.fillStyle = ORANGE;
  ctx.fillText('moover', brandX + parcelW, brandY);

  // Delivery reward tag.
  ctx.font = `650 21px ${FONT}`;
  const tagText = 'Delivery reward';
  const tagW = ctx.measureText(tagText).width + 64;
  const tagH = 46;
  const tagX = LEFT_W - 52 - tagW;
  const tagY = 43;
  ctx.fillStyle = 'rgba(248, 96, 12, 0.13)';
  roundRect(ctx, tagX, tagY, tagW, tagH, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(248, 96, 12, 0.48)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(tagX + 25, tagY + tagH / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd5bf';
  ctx.textBaseline = 'middle';
  ctx.fillText(tagText, tagX + 42, tagY + tagH / 2 + 1);
  ctx.textBaseline = 'alphabetic';

  // Headline — substantial, but with enough space for the code to become a
  // second visual anchor instead of a thin utility strip.
  let headSize = 159;
  ctx.font = `900 ${headSize}px ${FONT}`;
  const gap = 28;
  const headMax = 1078;
  const headWidth = () =>
    ctx.measureText(headA).width + gap + ctx.measureText(headB).width;
  while (headSize > 72 && headWidth() > headMax) {
    headSize -= 8;
    ctx.font = `900 ${headSize}px ${FONT}`;
  }
  const headBlock = headSize * 0.95;
  const groupTop = 245;
  const headY = groupTop + headSize * 0.79;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(headA, brandX, headY);
  const headAW = ctx.measureText(headA).width;
  ctx.fillStyle = ORANGE;
  ctx.fillText(headB, brandX + headAW + gap, headY);

  // Subtitle = offer title
  ctx.font = `520 36px ${FONT}`;
  ctx.fillStyle = '#dedbd9';
  const subY = groupTop + headBlock + 20 + 29;
  ctx.fillText(offer.title.slice(0, 42), brandX, subY);

  // Code bar
  const barX = 84;
  const barY = Math.round(subY + 40);
  const barW = 1078;
  const barH = 90;
  ctx.strokeStyle = '#36383e';
  ctx.lineWidth = 3;
  roundRect(ctx, barX, barY, barW, barH, 23);
  ctx.stroke();

  ctx.font = `500 26px ${FONT}`;
  ctx.fillStyle = '#aaa6a3';
  ctx.textBaseline = 'middle';
  ctx.fillText('USE CODE', barX + 22, barY + barH / 2 + 1);

  const divX = barX + 190;
  ctx.strokeStyle = '#36383e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(divX, barY + 12);
  ctx.lineTo(divX, barY + barH - 12);
  ctx.stroke();

  // Code
  ctx.font = `850 36px ${FONT}`;
  try {
    // Supported in Chromium; harmless elsewhere.
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '7px';
  } catch { /* letter-spacing unsupported — plain rendering */ }
  ctx.fillStyle = '#ff7124';
  ctx.fillText(offer.code.toUpperCase(), divX + 34, barY + barH / 2 + 1);
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
  } catch { /* noop */ }

  // Compact COPY pill (static on the export; omitted for print).
  if (opts.copyPill !== false) {
    ctx.font = `800 23px ${FONT}`;
    const copyText = 'COPY';
    const copyW = ctx.measureText(copyText).width + 44;
    const copyH = 66;
    const copyX = barX + barW - copyW - 10;
    const copyY = barY + (barH - copyH) / 2;
    ctx.fillStyle = COPY_ORANGE;
    roundRect(ctx, copyX, copyY, copyW, copyH, 16);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(copyText, copyX + copyW / 2, barY + barH / 2 + 1);
    ctx.textAlign = 'left';
  }

  // Print-only instruction, in the open space between the code bar and the
  // footnotes. Shrinks rather than overflowing the panel on a long string.
  if (opts.note) {
    let noteSize = 26;
    ctx.font = `550 ${noteSize}px ${FONT}`;
    while (noteSize > 16 && ctx.measureText(opts.note).width > barW) {
      noteSize -= 2;
      ctx.font = `550 ${noteSize}px ${FONT}`;
    }
    ctx.fillStyle = '#c6c1bd';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.note, brandX, barY + barH + 68);
  }

  // Footnotes use small orange markers to create a deliberate bottom rhythm.
  const footY = 750;
  ctx.font = `550 23px ${FONT}`;
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(90, footY - 7, 3.5, 0, Math.PI * 2);
  ctx.arc(558, footY - 7, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#c6c1bd';
  ctx.fillText(voucherFootnoteLeft(offer), 105, footY);
  ctx.fillText(voucherFootnoteRight(offer), 573, footY);

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not encode the voucher PNG'))),
      'image/png',
    );
  });
}

/** Download the voucher as `<CODE>-voucher.png` for sharing/printing. */
export async function downloadVoucherPng(offer: VoucherOffer): Promise<void> {
  const canvas = await renderVoucherCanvas(offer);
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${offer.code.toLowerCase()}-voucher.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/**
 * Open a print-only window with the voucher at photo size (6x2.8in at 300dpi
 * equivalent) — for handing a physical copy to a vendor. The art is embedded
 * as a data URL so the printout never depends on the dev server.
 */
export async function printVoucher(offer: VoucherOffer): Promise<void> {
  const [headA, headB] = voucherHeadline(offer);
  // Open synchronously inside the click handler: Safari treats any await
  // before window.open as the end of the user gesture and blocks the popup.
  const win = window.open('', '_blank', 'width=1000,height=600');
  if (!win) throw new Error('The print window was blocked — allow pop-ups and try again.');
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>${escapeHtml(offer.code)} voucher</title></head>
<body style="font-family: Inter, system-ui, sans-serif; padding: 24px;">Preparing voucher…</body></html>`);
  win.document.close();

  try {
    const art = await loadImage(ART_SRC);
    const artCanvas = document.createElement('canvas');
    artCanvas.width = art.naturalWidth;
    artCanvas.height = art.naturalHeight;
    const actx = artCanvas.getContext('2d');
    if (!actx) throw new Error('Canvas 2D is not available in this browser');
    actx.drawImage(art, 0, 0);
    const artDataUrl = artCanvas.toDataURL('image/png');

    win.document.open();
    win.document.write(`<!DOCTYPE html><html><head><title>${offer.code} voucher</title><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Inter, system-ui, sans-serif; display: flex; justify-content: center; padding: 24px; }
    .v { display: flex; width: 6in; aspect-ratio: 17/8; background: #09090b; overflow: hidden; color: #fff; }
    .l { position: relative; flex: 0 0 70.7%; padding: .29in .32in .28in .5in; display: flex; flex-direction: column; justify-content: space-between; background: radial-gradient(circle at 78% 40%, rgba(248,96,12,.12), transparent 36%), #09090b; overflow: hidden; }
    .top { display: flex; justify-content: space-between; align-items: center; }
    .brand { font-size: 15pt; font-weight: 750; letter-spacing: -.025em; } .brand em { font-style: normal; color: ${ORANGE}; }
    .tag { display: inline-flex; align-items: center; gap: 5pt; border: .5pt solid rgba(248,96,12,.48); border-radius: 99pt; background: rgba(248,96,12,.13); color: #ffd5bf; font-size: 9pt; font-weight: 650; padding: 5pt 8pt; }
    .tag:before, .foot span:before { content: ''; width: 3pt; height: 3pt; border-radius: 50%; background: ${ORANGE}; }
    .m { display: flex; flex-direction: column; }
    .head { font-size: 49pt; font-weight: 900; line-height: .95; letter-spacing: -.04em; white-space: nowrap; }
    .head.compact { font-size: 39pt; } .head b { color: ${ORANGE}; font-weight: 900; }
    .sub { font-size: 14pt; font-weight: 520; color: #dedbd9; margin-top: 7pt; }
    .bar { display: flex; align-items: center; gap: 13pt; border: 1.5pt solid #36383e; border-radius: 10pt; padding: 12pt 10pt; margin-top: 15pt; }
    .use { font-size: 10pt; line-height: 1.2; font-weight: 500; color: #aaa6a3; text-transform: uppercase; white-space: nowrap; }
    .use:after { content: ''; display: inline-block; width: 1.5pt; height: 25pt; margin-left: 13pt; background: #36383e; vertical-align: middle; }
    .code { flex: 1; font-size: 15pt; line-height: 1.1; font-weight: 850; letter-spacing: 3pt; color: #ff7124; }
    .foot { display: flex; gap: 34pt; font-size: 9pt; font-weight: 550; color: #c6c1bd; }
    .foot span { display: inline-flex; align-items: center; gap: 5pt; }
    .r { position: relative; flex: 1; border-left: .5pt solid rgba(255,124,52,.45); } .r img { width: 100%; height: 100%; object-fit: cover; display: block; }
    @media print { body { padding: 0; } .v { border-radius: 0; width: 100%; } @page { size: 6in 2.85in; margin: 0; } }
  </style></head><body>
    <div class="v"><div class="l">
      <div class="top"><div class="brand">Parcel<em>moover</em></div><span class="tag">Delivery reward</span></div>
      <div class="m">
        <div class="head${headA.length > 5 ? ' compact' : ''}">${headA} <b>${headB}</b></div>
        <div class="sub">${escapeHtml(offer.title)}</div>
        <div class="bar"><span class="use">Use code</span><span class="code">${escapeHtml(offer.code.toUpperCase())}</span></div>
      </div>
      <div class="foot"><span>${escapeHtml(voucherFootnoteLeft(offer))}</span><span>${escapeHtml(voucherFootnoteRight(offer))}</span></div>
    </div><div class="r"><img src="${artDataUrl}" alt=""/></div></div>
    <script>onload = () => { focus(); print(); }</script>
  </body></html>`);
    win.document.close();
  } catch (err) {
    win.close();
    throw err;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
