import type { VoucherOffer } from '../services/voucher.service';
import { toBsDate } from './nepaliDate';

/**
 * Shared data mapping between a VoucherOffer and the vendor-facing voucher.
 * Used by both the on-screen preview (components/VoucherPromo) and the PNG /
 * print export (utils/voucherImage) so the two can never drift apart.
 */

export const VOUCHER_ART_SRC = `${import.meta.env.BASE_URL}voucher-art-panel.png`;

/** Compact amount for display — drops the trailing .00 (Rs. 100, not Rs. 100.00). */
export function trimAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Headline split: white part + orange part, mirroring the Figma "20% / Off". */
export function voucherHeadline(
  offer: Pick<VoucherOffer, 'discountType' | 'discountAmount' | 'discountPercent'>,
): [string, string] {
  if (offer.discountType === 'percent') return [`${offer.discountPercent}%`, 'Off'];
  return [`Rs. ${trimAmount(offer.discountAmount)}`, 'Off'];
}

export function voucherFootnoteLeft(offer: Pick<VoucherOffer, 'expiresAt'>): string {
  return `Valid till ${toBsDate(offer.expiresAt)}`;
}

export function voucherFootnoteRight(
  offer: Pick<VoucherOffer, 'maxDiscount' | 'minimumCharge'>,
): string {
  if (offer.maxDiscount) return `Max discount Rs. ${trimAmount(offer.maxDiscount)}`;
  if (offer.minimumCharge > 0) return `Min. order Rs. ${trimAmount(offer.minimumCharge)}`;
  return 'Single use per vendor';
}
