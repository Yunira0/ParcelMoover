import QRCode from 'qrcode';
import type { VoucherCampaign } from '../services/voucher.service';
import { voucherBenefit } from '../services/voucher.service';
import { toBsDate } from './nepaliDate';
import { renderVoucherCanvas } from './voucherImage';

/**
 * Prints a voucher campaign in one job: page 1 is the full campaign poster
 * (the 1700x800 promo PNG with a `PREFIX-••••••` sample code), followed by
 * compact 8-up A4 slips with dashed cut guides — one unique code per slip.
 * Each slip carries a QR deep-link that opens Vouchers with the code filled in.
 */

export async function printCampaignSlips(campaign: VoucherCampaign, codes: string[]): Promise<void> {
  if (!codes.length) throw new Error('Select at least one code to print.');

  // Open synchronously inside the click handler: Safari treats any await
  // before window.open as the end of the user gesture and blocks the popup.
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) throw new Error('The print window was blocked — allow pop-ups and try again.');
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>${escapeHtml(campaign.name)} slips — ParcelMoover</title></head>
<body style="font-family: Inter, system-ui, sans-serif; padding: 24px;">Preparing slips…</body></html>`);
  win.document.close();

  try {
    // Poster reuses the promo renderer with a sample code (nothing to copy on paper).
    const posterOffer = {
      id: campaign.id, code: `${campaign.codePrefix}-••••••`,
      title: campaign.name, description: campaign.name,
      discountType: campaign.discountType, discountAmount: campaign.discountAmount,
      discountPercent: campaign.discountPercent, maxDiscount: campaign.maxDiscount,
      minimumCharge: campaign.minimumCharge,
      startsAt: campaign.startsAt, expiresAt: campaign.expiresAt,
      claimLimit: 1, claimedCount: 0, isActive: true,
    };
    const posterUrl = await renderVoucherCanvas(posterOffer).then(
      canvas => canvas.toDataURL('image/png'),
    );

    const claimBase = `${window.location.origin}/vouchers?code=`;
    const qrUrls = await Promise.all(
      codes.map(code => QRCode.toDataURL(`${claimBase}${encodeURIComponent(code)}`, {
        width: 320, margin: 1, color: { dark: '#000000', light: '#ffffff' },
      })),
    );

    const benefit = voucherBenefit(campaign);
    const validity = `Valid till ${toBsDate(campaign.expiresAt)}`;

    const slips = codes.map((code, i) => `
    <div class="slip">
      <div class="slip-main">
        <div class="slip-brand">Parcel<span>moover</span> · ${escapeHtml(campaign.name)}</div>
        <div class="slip-code">${escapeHtml(code)}</div>
        <div class="slip-benefit">${escapeHtml(benefit)} · ${escapeHtml(validity)}</div>
      </div>
      <img class="slip-qr" src="${qrUrls[i]}" alt="Claim ${escapeHtml(code)}" />
    </div>`).join('\n');

    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(campaign.name)} slips — ParcelMoover</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Inter, system-ui, sans-serif; color: #030712; }
    .poster { width: 190mm; margin: 0 auto; page-break-after: always; padding-top: 10mm; }
    .poster img { width: 100%; display: block; }
    .poster p { text-align: center; color: #4b5563; font-size: 10pt; margin-top: 6mm; }
    .sheet { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 64mm; gap: 0; padding: 10mm; }
    .slip { border: 0.5pt dashed #9ca3af; padding: 5mm; display: flex; align-items: center; gap: 5mm; overflow: hidden; }
    .slip-main { flex: 1; min-width: 0; }
    .slip-brand { font-size: 9pt; font-weight: 700; }
    .slip-brand span { color: #c2410c; }
    .slip-code { font-family: ui-monospace, Consolas, monospace; font-size: 21pt; font-weight: 700; letter-spacing: 1.5pt; margin: 2mm 0; }
    .slip-benefit { font-size: 9pt; color: #4b5563; }
    .slip-qr { width: 30mm; height: 30mm; flex: none; }
    @page { size: A4 portrait; margin: 0; }
    @media print { .sheet { padding: 10mm; } }
  </style>
</head>
<body>
  <div class="poster">
    <img src="${posterUrl}" alt="${escapeHtml(campaign.name)}" />
    <p>One slip per vendor — scan to claim, or enter the code under Vouchers.</p>
  </div>
  <div class="sheet">${slips}</div>
  <script>
    window.addEventListener('load', function() {
      window.focus();
      window.print();
      window.addEventListener('afterprint', function() { window.close(); });
    });
  </script>
</body>
</html>`);
    win.document.close();
  } catch (err) {
    win.close();
    throw err;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
