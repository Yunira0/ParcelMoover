import QRCode from 'qrcode';
import type { ReturnManifestDetail } from '../services/returnManifests.service';
import { toBsDate } from './nepaliDate';

const fmt = (n: number) => n.toFixed(2);

// The settlement statement builds its HTML by interpolating raw values, which
// breaks the document the moment a vendor or receiver name contains an "&" or
// a "<". Escaping here instead, the way printLabels and printRunSheet do.
function esc(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inlined rather than referenced as /brand/logo-light-bg.svg: a popup that
// fires window.print() on load can reach the print dialog before an external
// asset has painted, which prints the sheet with a hole where the logo goes.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 100" class="logo">
  <rect x="4" y="4" width="92" height="92" rx="22" fill="#F26522"/>
  <path d="M35 25 L66 50 L35 75 L35 61 L50 50 L35 39 Z" fill="#FFFFFF"/>
  <text x="122" y="65" font-family="Helvetica Neue, Arial, sans-serif" font-size="42" font-weight="700" letter-spacing="-0.5">
    <tspan fill="#262322">Parcel</tspan><tspan fill="#F26522">Moover</tspan>
  </text>
</svg>`;

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; padding: 10mm; }

  .hdr { display: flex; align-items: flex-start; justify-content: space-between; gap: 8mm; }
  .logo { width: 46mm; height: auto; display: block; }
  .tagline { font-size: 8px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #444; margin-top: 1mm; }
  .rtv-id { font-family: "Courier New", monospace; font-size: 11px; font-weight: 700; margin-top: 3mm; }

  .title-block { text-align: center; flex: 1; padding-top: 4mm; }
  .title { font-size: 20px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
  .doc-date { font-size: 10px; color: #444; margin-top: 2mm; }

  .qr { width: 28mm; height: 28mm; display: block; }
  .qr-caption { font-size: 7px; color: #666; text-align: center; margin-top: 1mm; letter-spacing: 0.4px; }

  .vendor-line { border-top: 1px solid #000; border-bottom: 1px solid #000; margin-top: 4mm; padding: 2.5mm 0; font-size: 11px; display: flex; flex-wrap: wrap; gap: 2mm 10mm; }

  table { border-collapse: collapse; margin-top: 4mm; width: 100%; }
  th, td { border: 1px solid #000; font-size: 9px; padding: 1.8mm 2mm; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 8px; letter-spacing: 0.4px; text-transform: uppercase; }
  td.num { text-align: right; white-space: nowrap; }
  td.mono { font-family: "Courier New", monospace; font-weight: 700; white-space: nowrap; }
  td.remark { min-width: 24mm; }
  tr { break-inside: avoid; }
  tfoot td { background: #eee; font-weight: 700; }

  .foot { display: flex; gap: 20mm; justify-content: space-between; margin-top: 12mm; }
  .foot h3 { font-size: 11px; font-weight: 700; margin-bottom: 2mm; }
  .foot div.line { font-size: 10px; margin-bottom: 1.5mm; }
  .sign-line { border-bottom: 1px solid #000; display: inline-block; min-width: 42mm; margin-left: 2mm; }
  .approve { min-width: 60mm; }

  .manifest + .manifest { break-before: page; margin-top: 16mm; }

  @media print {
    @page { size: A4 portrait; margin: 8mm; }
    body { padding: 0; }
  }
`;

function manifestSection(manifest: ReturnManifestDetail, qrDataUrl: string): string {
  const rows = manifest.parcels
    .map(
      (parcel, index) => `
        <tr>
          <td class="num">${index + 1}</td>
          <td class="mono">${esc(parcel.trackingId)}</td>
          <td>${esc(parcel.receiverName)}</td>
          <td>${esc(parcel.receiverPhone)}</td>
          <td>${esc(parcel.address || parcel.destination || '-')}</td>
          <td class="num">${fmt(parcel.codAmount)}</td>
          <td class="remark">${esc(parcel.remarks || '')}</td>
        </tr>`,
    )
    .join('');

  // Dated by the hand-over itself where there is one; an open manifest has not
  // gone anywhere yet, so it falls back to the day it was started.
  const docDate = manifest.sentAt || manifest.createdAt;

  return `
    <section class="manifest">
      <div class="hdr">
        <div>
          ${LOGO_SVG}
          <div class="tagline">Your parcel, our priority</div>
          <div class="rtv-id">RTV ID: ${esc(manifest.manifestNo)}</div>
        </div>
        <div class="title-block">
          <div class="title">RTV &mdash; ${esc(manifest.vendorName)}</div>
          <div class="doc-date">Date: ${esc(docDate.slice(0, 10))} / ${esc(toBsDate(docDate) || '-')}</div>
        </div>
        <div>
          <img class="qr" src="${qrDataUrl}" alt="Manifest QR code" />
          <div class="qr-caption">${esc(manifest.manifestNo)}</div>
        </div>
      </div>

      <div class="vendor-line">
        <span><b>Vendor:</b> ${esc(manifest.vendorName)}</span>
        ${manifest.vendorPhone ? `<span><b>Phone:</b> ${esc(manifest.vendorPhone)}</span>` : ''}
        <span><b>Parcels:</b> ${manifest.parcels.length}</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>S.N</th>
            <th>AWB No.</th>
            <th>Receiver</th>
            <th>Contact</th>
            <th>Address</th>
            <th>COD</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7">No parcels on this manifest.</td></tr>'}</tbody>
      </table>

      <div class="foot">
        <div>
          <h3>Rider details:</h3>
          <div class="line">Rider${manifest.riderName ? `: ${esc(manifest.riderName)}` : ''}</div>
          <div class="line">Rider Phone${manifest.riderPhone ? `: ${esc(manifest.riderPhone)}` : ''}</div>
          ${manifest.riderVehicleNo ? `<div class="line">Vehicle: ${esc(manifest.riderVehicleNo)}</div>` : ''}
          <div class="line">Signature <span class="sign-line"></span></div>
        </div>
        <div class="approve">
          <h3>Received By:</h3>
          <div class="line">Vendor: ${esc(manifest.vendorName)}</div>
          <div class="line">Signature <span class="sign-line"></span></div>
          <div class="line">Date <span class="sign-line"></span></div>
        </div>
      </div>
    </section>`;
}

/**
 * Opens a print window holding one RTV hand-over sheet per manifest.
 *
 * Several manifests go into one window with a page break between them rather
 * than one popup each - a rider doing a multi-vendor round trip prints the lot
 * in one go, and browsers block the second popup anyway.
 */
export async function printReturnManifests(manifests: ReturnManifestDetail[]): Promise<void> {
  if (manifests.length === 0) return;

  // Opened before the await, like printLabels: a window.open() that happens
  // after an async gap is no longer attributable to the click and gets blocked.
  const win = window.open('', '_blank', 'width=900,height=650');
  if (!win) {
    alert('Please allow popups for this site to open the manifest.');
    return;
  }

  const qrUrls = await Promise.all(
    manifests.map((manifest) =>
      // The manifest number is the scannable handle on the hand-over, the same
      // way the label QR carries a tracking id.
      QRCode.toDataURL(manifest.manifestNo, {
        width: 320,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      }),
    ),
  );

  const title = manifests.length === 1
    ? `RTV ${manifests[0]!.manifestNo}`
    : `RTV Manifests (${manifests.length})`;

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)} — ParcelMoover</title>
  <style>${CSS}</style>
</head>
<body>
  ${manifests.map((manifest, i) => manifestSection(manifest, qrUrls[i]!)).join('')}
<script>
  window.addEventListener('load', function() { window.print(); });
<\/script>
</body>
</html>`);
  win.document.close();
}
