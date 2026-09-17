import { useState } from 'react';
import type { VoucherOffer } from '../services/voucher.service';
import { VOUCHER_ART_SRC, voucherFootnoteLeft, voucherFootnoteRight, voucherHeadline } from '../utils/voucherArt';
import './VoucherPromo.css';

interface VoucherPromoProps {
  offer: VoucherOffer;
  /** Compact headline sizing for long amounts (e.g. "Rs. 5,000 Off"). Rendered PNG uses the same rule. */
  compact?: boolean;
  /** Override the code bar text — the campaign poster shows e.g. "DASH-••••••". */
  codeText?: string;
  /** Poster mode renders the code as static text (nothing to copy). */
  copyable?: boolean;
}

/**
 * Vendor-facing promo voucher, recreated from the approved Figma voucher
 * (node 2:20) and driven by live offer data. Scales to any width via
 * container-query units; the PNG export in utils/voucherImage.ts mirrors
 * this layout at 1700x800.
 */
export default function VoucherPromo({ offer, compact, codeText, copyable = true }: VoucherPromoProps) {
  const [copied, setCopied] = useState(false);
  const [headA, headB] = voucherHeadline(offer);
  const longHeadline = compact ?? headA.length > 5;
  const code = codeText ?? offer.code;

  async function copyCode() {
    if (!copyable) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="voucher-promo" role="group" aria-label={`${code}: ${headA} ${headB}`}>
      <div className="vp-left">
        <div className="vp-top">
          <span className="vp-brand">Parcel<em>moover</em></span>
          <span className="vp-tag">Delivery reward</span>
        </div>
        <div className="vp-main">
          <p className={`vp-head${longHeadline ? ' vp-head-compact' : ''}`}>
            <span className="vp-head-a">{headA}</span>{' '}
            <span className="vp-head-b">{headB}</span>
          </p>
          <p className="vp-sub">{offer.title}</p>
          <div className="vp-codebar">
            <span className="vp-use">Use code</span>
            <span className="vp-divider" aria-hidden="true" />
            <strong className="vp-code">{code}</strong>
            {copyable && (
              <button type="button" className="vp-copy" onClick={() => void copyCode()}>
                {copied ? 'COPIED' : 'COPY'}
              </button>
            )}
          </div>
        </div>
        <div className="vp-foot">
          <span>{voucherFootnoteLeft(offer)}</span>
          <span>{voucherFootnoteRight(offer)}</span>
        </div>
      </div>
      <div className="vp-art" aria-hidden="true">
        <img src={VOUCHER_ART_SRC} alt="" draggable={false} />
      </div>
    </div>
  );
}
