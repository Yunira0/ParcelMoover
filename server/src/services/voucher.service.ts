import { z } from 'zod';
import prisma from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../utils/AppError';
import { resolveOwnVendorId, type ScopeActor } from './vendor-scope.service';
import { vendorHasApprovedKyc, type KycApprovalDb } from './kyc.service';

// ── Daraz-style shipping vouchers ────────────────────────────────────────────
// An admin publishes an offer (MOVE100 — Rs. 100 off). Vendors claim it once
// into "My Vouchers" and attach the claim while creating an outbound delivery
// order. The order_voucher_pricing trigger does the actual price math so the
// status, price, claim state and audit event commit together; this service
// validates up front so vendors get readable errors instead of raw trigger
// messages, and owns everything the trigger cannot: publishing, the claim
// window/limit accounting, and resolving a code to a claim at order time.

export const VOUCHER_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

const codeSchema = z.string().trim().min(3).max(32)
  .transform(v => v.toUpperCase())
  .refine(v => VOUCHER_CODE_REGEX.test(v),
    'Code must be 3–32 characters: letters, numbers, _ or -, starting with a letter or number');

// Shared offer terms (title through window). Campaigns reuse the same shape
// for their terms snapshot, minus the single code / claim limit.
export const voucherTermsBase = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(500),
  discountType: z.enum(['fixed', 'percent']).default('fixed'),
  // Fixed Rs off (MOVE100 → 100). Percent offers leave this unset (stored 0).
  discountAmount: z.number().positive().max(5000).multipleOf(0.01).optional(),
  // Percent off (10 = 10%). Capped per order by maxDiscount when set.
  discountPercent: z.number().min(0.01).max(100).optional(),
  maxDiscount: z.number().positive().max(5000).multipleOf(0.01).optional(),
  minimumCharge: z.number().min(0).max(100000).default(0),
  startsAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
});

export function refineVoucherTerms(v: {
  discountType: string; discountAmount?: number | undefined; discountPercent?: number | undefined;
  startsAt: string; expiresAt: string;
}, ctx: z.RefinementCtx) {
  if (v.discountType === 'fixed' && v.discountAmount === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountAmount'], message: 'discountAmount is required for a fixed voucher' });
  }
  if (v.discountType === 'fixed' && v.discountPercent !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountPercent'], message: 'discountPercent only applies to percent vouchers' });
  }
  if (v.discountType === 'percent' && v.discountPercent === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountPercent'], message: 'discountPercent is required for a percent voucher' });
  }
  if (v.discountType === 'percent' && v.discountAmount !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountAmount'], message: 'discountAmount only applies to fixed vouchers' });
  }
  if (new Date(v.expiresAt).getTime() <= new Date(v.startsAt).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Expiry must be after the start time' });
  }
}

export const createVoucherSchema = z.object({
  code: codeSchema,
  ...voucherTermsBase.shape,
  claimLimit: z.number().int().min(1).max(100000),
  isActive: z.boolean().default(true),
}).strict().superRefine(refineVoucherTerms);

export type VoucherOffer = {
  id: string; code: string; title: string; description: string;
  discountType: string; discountAmount: number; discountPercent: number | null;
  maxDiscount: number | null; minimumCharge: number;
  startsAt: string; expiresAt: string;
  claimLimit: number; claimedCount: number; isActive: boolean;
  campaignId: string | null;
};

export type AvailableVoucher = VoucherOffer & {
  spotsLeft: number;
  myClaim: { id: string; state: string } | null;
};

export type MyVoucher = {
  claimId: string; state: string; claimedAt: string;
  usable: boolean; unusableReason: string | null;
  voucher: VoucherOffer;
};

function toOffer(v: {
  id: string; code: string; title: string; description: string;
  discount_type: string; discount_amount: unknown; discount_percent: unknown;
  max_discount: unknown; minimum_charge: unknown;
  starts_at: Date; expires_at: Date;
  claim_limit: number; claimed_count: number; is_active: boolean;
  campaign_id?: string | null;
}): VoucherOffer {
  return {
    id: v.id, code: v.code, title: v.title, description: v.description,
    discountType: v.discount_type,
    discountAmount: Number(v.discount_amount),
    discountPercent: v.discount_percent === null ? null : Number(v.discount_percent),
    maxDiscount: v.max_discount === null ? null : Number(v.max_discount),
    minimumCharge: Number(v.minimum_charge),
    startsAt: v.starts_at.toISOString(), expiresAt: v.expires_at.toISOString(),
    claimLimit: v.claim_limit, claimedCount: v.claimed_count, isActive: v.is_active,
    campaignId: v.campaign_id ?? null,
  };
}

/** Preview the discount a voucher gives on a delivery fee. Pure — shared by the order flow. */
export function voucherDiscountForFee(
  offer: { discountType: string; discountAmount: number; discountPercent: number | null; maxDiscount: number | null },
  fee: number,
): number {
  const raw = offer.discountType === 'percent'
    ? Math.min((fee * (offer.discountPercent ?? 0)) / 100, offer.maxDiscount ?? fee)
    : offer.discountAmount;
  return Math.min(Math.max(0, Math.round(raw * 100) / 100), Math.max(0, fee));
}

export function voucherUsability(
  claimState: string,
  offer: VoucherOffer,
  now = new Date(),
  campaignActive: boolean | null = null,
): { usable: boolean; reason: string | null } {
  if (claimState !== 'claimed') {
    return { usable: false, reason: claimState === 'reserved' ? 'Reserved on an open order' : 'Already used' };
  }
  if (!offer.isActive) return { usable: false, reason: 'Paused by the office' };
  if (campaignActive === false) return { usable: false, reason: 'Campaign paused' };
  if (new Date(offer.startsAt).getTime() > now.getTime()) return { usable: false, reason: 'Not started yet' };
  if (new Date(offer.expiresAt).getTime() <= now.getTime()) return { usable: false, reason: 'Expired' };
  return { usable: true, reason: null };
}

// Claims are a shipping incentive, not cash — but like the Parcel Credits
// pilot before them they still require a verified identity behind the vendor,
// so throwaway accounts cannot farm every published offer.
async function requireApprovedKycVendor(db: KycApprovalDb, vendorId: string): Promise<void> {
  if (!(await vendorHasApprovedKyc(db, vendorId))) {
    throw new AppError(400, 'This vendor needs an approved KYC application before claiming vouchers');
  }
}

async function resolveOwnVendorOrThrow(actor: ScopeActor): Promise<string> {
  const vendorId = await resolveOwnVendorId(actor);
  if (!vendorId) throw new AppError(403, 'Vouchers are available to vendor accounts');
  return vendorId;
}

export async function createVoucher(actor: ScopeActor, raw: unknown): Promise<VoucherOffer> {
  if (!actor.roles.includes('super_admin')) throw new AppError(403, 'Only a super admin can create vouchers');
  const input = createVoucherSchema.parse(raw);
  const starts = new Date(input.startsAt);
  const expires = new Date(input.expiresAt);
  if (expires.getTime() <= Date.now()) throw new AppError(400, 'Expiry must be in the future');

  try {
    const created = await prisma.vouchers.create({
      data: {
        code: input.code, title: input.title.trim(), description: input.description.trim(),
        discount_type: input.discountType,
        discount_amount: input.discountType === 'fixed' ? input.discountAmount! : 0,
        discount_percent: input.discountType === 'percent' ? input.discountPercent! : null,
        max_discount: input.maxDiscount ?? null,
        minimum_charge: input.minimumCharge,
        starts_at: starts, expires_at: expires,
        claim_limit: input.claimLimit, is_active: input.isActive,
        created_by: actor.id,
      },
    });
    await prisma.audit_logs.create({
      data: {
        actor_id: actor.id, entity_type: 'voucher', entity_id: created.id,
        action: 'VOUCHER_CREATED',
        new_data: { code: created.code, discountType: created.discount_type },
      },
    });
    return toOffer(created);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError(409, `Voucher code ${input.code} already exists`);
    }
    throw e;
  }
}

export async function setVoucherActive(actor: ScopeActor, voucherId: string, isActive: boolean): Promise<VoucherOffer> {
  if (!actor.roles.includes('super_admin')) throw new AppError(403, 'Only a super admin can pause or resume vouchers');
  const updated = await prisma.vouchers.update({
    where: { id: z.uuid().parse(voucherId) },
    data: { is_active: isActive },
  }).catch(() => { throw new AppError(404, 'Voucher not found'); });
  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id, entity_type: 'voucher', entity_id: updated.id,
      action: isActive ? 'VOUCHER_ACTIVATED' : 'VOUCHER_PAUSED',
    },
  });
  return toOffer(updated);
}

export async function listAllVouchers(actor: ScopeActor, page = 1) {
  if (!actor.roles.some(r => ['super_admin', 'admin'].includes(r))) {
    throw new AppError(403, 'Not authorized to list voucher offers');
  }
  const [total, rows] = await Promise.all([
    prisma.vouchers.count(),
    prisma.vouchers.findMany({ orderBy: [{ created_at: 'desc' }], skip: (page - 1) * 20, take: 20 }),
  ]);
  return { data: rows.map(toOffer), page, totalPages: Math.max(1, Math.ceil(total / 20)), total };
}

/** Browse cards: live listed offers with remaining spots and this vendor's claim state.
 *  Bulk campaign codes are unlisted — vendors claim those by code from a slip. */
export async function listAvailableVouchers(actor: ScopeActor): Promise<AvailableVoucher[]> {
  const vendorId = await resolveOwnVendorOrThrow(actor);
  const now = new Date();
  const offers = await prisma.vouchers.findMany({
    where: { is_active: true, is_listed: true, starts_at: { lte: now }, expires_at: { gt: now } },
    orderBy: [{ expires_at: 'asc' }],
    take: 100,
  });
  const live = offers.filter(o => o.claimed_count < o.claim_limit);
  const claims = live.length
    ? await prisma.voucher_claims.findMany({
        where: { vendor_id: vendorId, voucher_id: { in: live.map(o => o.id) } },
        select: { id: true, voucher_id: true, state: true },
      })
    : [];
  const byVoucher = new Map(claims.map(c => [c.voucher_id, c]));
  return live.map(o => {
    const offer = toOffer(o);
    const mine = byVoucher.get(o.id) ?? null;
    return { ...offer, spotsLeft: o.claim_limit - o.claimed_count, myClaim: mine ? { id: mine.id, state: mine.state } : null };
  });
}

export async function claimVoucher(actor: ScopeActor, raw: unknown): Promise<MyVoucher> {
  const input = z.object({
    code: codeSchema.optional(),
    voucherId: z.uuid().optional(),
  }).strict().refine(v => v.code || v.voucherId, 'Provide a voucher code or id').parse(raw);
  const vendorId = await resolveOwnVendorOrThrow(actor);

  return prisma.$transaction(async tx => {
    // Serialize concurrent claims on the same vendor account.
    await tx.$queryRaw`SELECT id FROM vendors WHERE id = ${vendorId}::uuid FOR UPDATE`;
    await requireApprovedKycVendor(tx as unknown as KycApprovalDb, vendorId);

    // Lock the offer before checking its window and remaining spots, so two
    // vendors racing the last spot cannot both take it.
    const rows = input.voucherId
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM vouchers WHERE id = ${input.voucherId}::uuid FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM vouchers WHERE code = ${input.code} FOR UPDATE`;
    if (!rows[0]) throw new AppError(404, 'Voucher not found or no longer available');
    const offer = await tx.vouchers.findUniqueOrThrow({ where: { id: rows[0].id } });
    const now = new Date();
    if (!offer.is_active || offer.starts_at > now || offer.expires_at <= now) {
      throw new AppError(400, `Voucher ${offer.code} is not currently claimable`);
    }
    if (offer.claimed_count >= offer.claim_limit) {
      throw new AppError(409, `Voucher ${offer.code} has been fully claimed`);
    }
    // Campaign codes: the campaign must be running, and each vendor may only
    // take max_per_vendor codes from one campaign (anti-gaming for flyers).
    if (offer.campaign_id) {
      const campaign = await tx.voucher_campaigns.findUnique({ where: { id: offer.campaign_id } });
      if (!campaign || campaign.status !== 'active') {
        throw new AppError(400, `Voucher ${offer.code} is not currently claimable`);
      }
      const siblingIds = await tx.vouchers.findMany({
        where: { campaign_id: offer.campaign_id }, select: { id: true },
      });
      const mineInCampaign = await tx.voucher_claims.count({
        where: { vendor_id: vendorId, voucher_id: { in: siblingIds.map(s => s.id) } },
      });
      if (mineInCampaign >= campaign.max_per_vendor) {
        throw new AppError(409, 'You have already claimed a voucher from this campaign');
      }
    }
    if (await tx.voucher_claims.findUnique({
      where: { voucher_id_vendor_id: { voucher_id: offer.id, vendor_id: vendorId } },
      select: { id: true },
    })) {
      throw new AppError(409, `You have already claimed voucher ${offer.code}`);
    }

    const claim = await tx.voucher_claims.create({
      data: { voucher_id: offer.id, vendor_id: vendorId, claimed_by: actor.id },
    });
    await tx.vouchers.update({ where: { id: offer.id }, data: { claimed_count: { increment: 1 } } });
    await tx.voucher_events.create({ data: { claim_id: claim.id, kind: 'claim', discount: 0 } });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id, entity_type: 'voucher_claim', entity_id: claim.id,
        action: 'VOUCHER_CLAIMED', new_data: { voucherId: offer.id, code: offer.code, vendorId },
      },
    });
    const full = toOffer({ ...offer, claimed_count: offer.claimed_count + 1 });
    return { claimId: claim.id, state: claim.state, claimedAt: claim.claimed_at.toISOString(), usable: true, unusableReason: null, voucher: full };
  });
}

/** "My Vouchers": every claim on this vendor's account with its live usability. */
export async function listMyVouchers(actor: ScopeActor, requestedVendorId?: string): Promise<MyVoucher[]> {
  let vendorId: string;
  if (actor.roles.some(r => ['super_admin', 'admin'].includes(r)) && requestedVendorId) {
    vendorId = z.uuid().parse(requestedVendorId);
  } else {
    vendorId = await resolveOwnVendorOrThrow(actor);
  }
  const claims = await prisma.voucher_claims.findMany({
    where: { vendor_id: vendorId }, orderBy: [{ claimed_at: 'desc' }], take: 100,
  });
  if (!claims.length) return [];
  const offers = await prisma.vouchers.findMany({ where: { id: { in: claims.map(c => c.voucher_id) } } });
  const byId = new Map(offers.map(o => [o.id, o]));
  const campaignIds = [...new Set(offers.map(o => o.campaign_id).filter((c): c is string => !!c))];
  const campaigns = campaignIds.length
    ? await prisma.voucher_campaigns.findMany({ where: { id: { in: campaignIds } }, select: { id: true, status: true } })
    : [];
  const campaignActive = new Map(campaigns.map(c => [c.id, c.status === 'active']));
  const now = new Date();
  return claims.flatMap(c => {
    const offer = byId.get(c.voucher_id);
    if (!offer) return [];
    const shaped = toOffer(offer);
    const { usable, reason } = voucherUsability(
      c.state, shaped, now,
      shaped.campaignId ? (campaignActive.get(shaped.campaignId) ?? false) : null,
    );
    return [{
      claimId: c.id, state: c.state, claimedAt: c.claimed_at.toISOString(),
      usable, unusableReason: reason, voucher: shaped,
    }];
  });
}

export type VendorClaimRef = { claimId?: string | undefined; code?: string | undefined };

/**
 * Resolve a vendor's claim for order creation, inside the caller's transaction.
 * Throws readable errors; the pricing trigger re-checks everything at write time.
 */
export async function resolveVendorClaimTx(
  tx: Prisma.TransactionClient,
  vendorId: string | null,
  ref: VendorClaimRef,
): Promise<{ id: string; state: string; vendor_id: string; voucher: VendorClaimVoucher }> {
  if (!vendorId) throw new AppError(400, 'Vouchers are only available on vendor orders');
  const claim = ref.claimId
    ? await tx.voucher_claims.findUnique({ where: { id: ref.claimId } })
    : await (async () => {
        const code = ref.code!.trim().toUpperCase();
        const offer = await tx.vouchers.findUnique({ where: { code } });
        if (!offer) throw new AppError(404, `Voucher ${code} does not exist`);
        const mine = await tx.voucher_claims.findUnique({
          where: { voucher_id_vendor_id: { voucher_id: offer.id, vendor_id: vendorId } },
        });
        if (!mine) throw new AppError(400, `Claim voucher ${code} in My Vouchers before using it`);
        return mine;
      })();
  if (!claim) throw new AppError(404, 'Voucher claim not found');
  if (claim.vendor_id !== vendorId) throw new AppError(400, 'This voucher belongs to another vendor');
  if (claim.state !== 'claimed') throw new AppError(400, 'This voucher has already been used on an order');
  const offer = await tx.vouchers.findUniqueOrThrow({ where: { id: claim.voucher_id } });
  const now = new Date();
  if (!offer.is_active || offer.starts_at > now || offer.expires_at <= now) {
    throw new AppError(400, `Voucher ${offer.code} is expired or paused`);
  }
  if (offer.campaign_id) {
    const campaign = await tx.voucher_campaigns.findUnique({ where: { id: offer.campaign_id }, select: { status: true } });
    if (!campaign || campaign.status !== 'active') {
      throw new AppError(400, `Voucher ${offer.code} is expired or paused`);
    }
  }
  return { id: claim.id, state: claim.state, vendor_id: claim.vendor_id, voucher: offer };
}

type VendorClaimVoucher = {
  id: string; code: string;
  discount_type: string; discount_amount: Prisma.Decimal;
  discount_percent: Prisma.Decimal | null; max_discount: Prisma.Decimal | null;
  minimum_charge: Prisma.Decimal;
};
