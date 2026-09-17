import api from '../utils/api';

export interface VoucherOffer {
  id: string;
  code: string;
  title: string;
  description: string;
  discountType: 'fixed' | 'percent';
  discountAmount: number;
  discountPercent: number | null;
  maxDiscount: number | null;
  minimumCharge: number;
  startsAt: string;
  expiresAt: string;
  claimLimit: number;
  claimedCount: number;
  isActive: boolean;
}

export interface AvailableVoucher extends VoucherOffer {
  spotsLeft: number;
  myClaim: { id: string; state: string } | null;
}

export interface MyVoucher {
  claimId: string;
  state: string;
  claimedAt: string;
  usable: boolean;
  unusableReason: string | null;
  voucher: VoucherOffer;
}

export interface VoucherListResult {
  data: VoucherOffer[];
  page: number;
  totalPages: number;
  total: number;
}

export interface CampaignStats {
  generated: number;
  claimed: number;
  redeemed: number;
  expired: number;
}

export interface VoucherCampaign {
  id: string;
  name: string;
  codePrefix: string;
  status: 'active' | 'paused' | 'ended';
  discountType: 'fixed' | 'percent';
  discountAmount: number;
  discountPercent: number | null;
  maxDiscount: number | null;
  minimumCharge: number;
  startsAt: string;
  expiresAt: string;
  maxPerVendor: number;
  codeCount: number;
  createdAt: string;
  stats: CampaignStats;
}

export interface CampaignListResult {
  data: VoucherCampaign[];
  page: number;
  totalPages: number;
  total: number;
}

export type CampaignCodeState = 'unclaimed' | 'claimed' | 'redeemed' | 'expired' | 'paused';

export interface CampaignCodeRow {
  id: string;
  code: string;
  title: string;
  description: string;
  isActive: boolean;
  state: CampaignCodeState;
  vendorName: string | null;
  claimedAt: string | null;
  expiresAt: string;
}

export interface CampaignCodeListResult {
  data: CampaignCodeRow[];
  page: number;
  totalPages: number;
  total: number;
}

/** Staff see every offer (paginated); vendors see live browse cards. */
export const listVouchers = async (page = 1): Promise<VoucherListResult | AvailableVoucher[]> =>
  (await api.get('/vouchers', { params: { page } })).data.data;

export const listMyVouchers = async (vendorId?: string): Promise<MyVoucher[]> =>
  (await api.get('/vouchers/mine', { params: vendorId ? { vendorId } : {} })).data.data;

export const createVoucher = async (data: {
  code: string;
  title: string;
  description: string;
  discountType: 'fixed' | 'percent';
  discountAmount?: number;
  discountPercent?: number;
  maxDiscount?: number;
  minimumCharge?: number;
  startsAt: string;
  expiresAt: string;
  claimLimit: number;
}): Promise<VoucherOffer> => (await api.post('/vouchers', data)).data.data;

export const setVoucherActive = async (id: string, isActive: boolean): Promise<VoucherOffer> =>
  (await api.patch(`/vouchers/${id}`, { isActive })).data.data;

export const claimVoucher = async (data: { code?: string; voucherId?: string }): Promise<MyVoucher> =>
  (await api.post('/vouchers/claim', data)).data.data;

/** Bulk campaign directory (super_admin/admin). */
export const listCampaigns = async (page = 1): Promise<CampaignListResult> =>
  (await api.get('/voucher-campaigns', { params: { page } })).data.data;

export const getCampaign = async (id: string): Promise<VoucherCampaign> =>
  (await api.get(`/voucher-campaigns/${id}`)).data.data;

export const createCampaign = async (data: {
  name: string;
  codePrefix: string;
  codeCount: number;
  maxPerVendor?: number;
  title: string;
  description: string;
  discountType: 'fixed' | 'percent';
  discountAmount?: number;
  discountPercent?: number;
  maxDiscount?: number;
  minimumCharge?: number;
  startsAt: string;
  expiresAt: string;
}): Promise<{ campaign: VoucherCampaign; codes: string[] }> =>
  (await api.post('/voucher-campaigns', data)).data.data;

export const setCampaignStatus = async (id: string, status: 'active' | 'paused' | 'ended'): Promise<VoucherCampaign> =>
  (await api.patch(`/voucher-campaigns/${id}/status`, { status })).data.data;

export const listCampaignCodes = async (
  id: string, opts: { page?: number; q?: string; state?: string } = {},
): Promise<CampaignCodeListResult> =>
  (await api.get(`/voucher-campaigns/${id}/codes`, { params: opts })).data.data;

/** CSV download URL for the full generated code list (auth via same session/cookies). */
export const campaignCsvUrl = (id: string): string => {
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  return `${base}/api/voucher-campaigns/${id}/codes.csv`;
};

/** Human-readable benefit, e.g. "Rs. 100 off" or "10% off (up to Rs. 80)". */
export const voucherBenefit = (v: Pick<VoucherOffer, 'discountType' | 'discountAmount' | 'discountPercent' | 'maxDiscount'>): string => {
  if (v.discountType === 'percent') {
    const cap = v.maxDiscount ? ` (up to Rs. ${v.maxDiscount})` : '';
    return `${v.discountPercent}% off${cap}`;
  }
  return `Rs. ${v.discountAmount} off`;
};

/** Preview the discount on a delivery fee. Mirrors the server's pricing trigger. */
export const voucherDiscountForFee = (
  v: Pick<VoucherOffer, 'discountType' | 'discountAmount' | 'discountPercent' | 'maxDiscount'>,
  fee: number,
): number => {
  const raw = v.discountType === 'percent'
    ? Math.min((fee * (v.discountPercent ?? 0)) / 100, v.maxDiscount ?? fee)
    : v.discountAmount;
  return Math.min(Math.max(0, Math.round(raw * 100) / 100), Math.max(0, fee));
};
