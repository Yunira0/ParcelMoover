import type { VoucherCampaign } from '../services/voucher.service';
import { renderVoucherCanvas } from './voucherImage';

/**
 * Prints a voucher campaign as one poster per code — the 1700x800 promo art
 * with that code's real value in its USE CODE bar, one page each, ready to
 * hand out. The vendor types the code on their order; nothing to claim first.
 */

export async function printCampaignSlips(campaign: VoucherCampaign, codes: string[]): Promise<void> {
  if (!codes.length) throw new Error('Select at least one code to print.');

  // Open synchronously inside the click handler: Safari treats any await
  // before window.open as the end of the user gesture and blocks the popup.
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) throw new Error('The print window was blocked — allow pop-ups and try again.');
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>${escapeHtml(campaign.name)} — ParcelMoover</title></head>
<body style="font-family: Inter, system-ui, sans-serif; padding: 24px;">Preparing vouchers…</body></html>`);
  win.document.close();

  try {
    const campaignTerms = {
      id: campaign.id,
      title: campaign.name, description: campaign.name,
      discountType: campaign.discountType, discountAmount: campaign.discountAmount,
      discountPercent: campaign.discountPercent, maxDiscount: campaign.maxDiscount,
      minimumCharge: campaign.minimumCharge,
      startsAt: campaign.startsAt, expiresAt: campaign.expiresAt,
      claimLimit: 1, claimedCount: 0, usesPerVendor: 1, isActive: true,
    };
    // One render per code so each poster carries its own code, rather than the
    // masked PREFIX-•••••• sample the shared campaign poster used to show.
    const posterUrls = await Promise.all(
      codes.map(code =>
        renderVoucherCanvas(
          { ...campaignTerms, code },
          { copyPill: false, note: 'Enter this code while creating your order.' },
        ).then(canvas => canvas.toDataURL('image/png')),
      ),
    );

    const posters = posterUrls.map((url, i) => `
  <div class="poster">
    <img src="${url}" alt="${escapeHtml(campaign.name)} — ${escapeHtml(codes[i]!)}" />
  </div>`).join('\n');

    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(campaign.name)} — ParcelMoover</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Inter, system-ui, sans-serif; color: #030712; }
    .poster { width: 190mm; margin: 0 auto; page-break-after: always; padding-top: 10mm; }
    /* No trailing blank sheet after the last code. */
    .poster:last-of-type { page-break-after: auto; }
    .poster img { width: 100%; display: block; }
    @page { size: A4 portrait; margin: 0; }
  </style>
</head>
<body>
${posters}
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
