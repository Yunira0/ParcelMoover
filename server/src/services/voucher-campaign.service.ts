import { randomInt } from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../utils/AppError';
import { refineVoucherTerms, voucherTermsBase } from './voucher.service';
import type { ScopeActor } from './vendor-scope.service';

// ── Bulk voucher campaigns ─────────────────────────────────────────────────
// A campaign (e.g. Dashain 20% off) holds shared terms plus a batch of unique
// single-claim codes for printed slips. Codes are ordinary vouchers rows with
// campaign_id set, claim_limit 1 and is_listed false — the claim, order and
// pricing paths treat them like any other code. Campaign rows carry status
// only, so pausing never rewrites published terms.

export const CAMPAIGN_STATUS = ['active', 'paused', 'ended'] as const;

// Unambiguous alphabet for printed slips: no 0/O, 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RANDOM_LEN = 6;

const prefixSchema = z.string().trim().min(2).max(10)
  .transform(v => v.toUpperCase())
  .refine(v => /^[A-Z0-9]{2,10}$/.test(v), 'Prefix must be 2–10 letters/numbers');

// Same terms as a standalone offer, minus the single code / claim limit.
export const createCampaignSchema = z.object({
  name: z.string().trim().min(3).max(60),
  codePrefix: prefixSchema,
  codeCount: z.number().int().min(1).max(5000),
  maxPerVendor: z.number().int().min(1).max(10).default(1),
  ...voucherTermsBase.shape,
}).strict().superRefine(refineVoucherTerms);

export type VoucherCampaign = {
  id: string; name: string; codePrefix: string; status: string;
  discountType: string; discountAmount: number; discountPercent: number | null;
  maxDiscount: number | null; minimumCharge: number;
  startsAt: string; expiresAt: string; maxPerVendor: number;
  codeCount: number; createdAt: string;
};

export type CampaignStats = {
  generated: number; claimed: number; redeemed: number; expired: number;
};

export type CampaignCodeState = 'unclaimed' | 'claimed' | 'redeemed' | 'expired' | 'paused';

export type CampaignCodeRow = {
  id: string; code: string; title: string; description: string;
  isActive: boolean;
  state: CampaignCodeState; vendorName: string | null; claimedAt: string | null;
  expiresAt: string;
};

type CampaignRow = {
  id: string; name: string; code_prefix: string; status: string;
  discount_type: string; discount_amount: unknown; discount_percent: unknown;
  max_discount: unknown; minimum_charge: unknown;
  starts_at: Date; expires_at: Date; max_per_vendor: number;
  created_at: Date; _count?: { vouchers: number };
};

function toCampaign(c: CampaignRow, codeCount?: number): VoucherCampaign {
  return {
    id: c.id, name: c.name, codePrefix: c.code_prefix, status: c.status,
    discountType: c.discount_type,
    discountAmount: Number(c.discount_amount),
    discountPercent: c.discount_percent === null ? null : Number(c.discount_percent),
    maxDiscount: c.max_discount === null ? null : Number(c.max_discount),
    minimumCharge: Number(c.minimum_charge),
    startsAt: c.starts_at.toISOString(), expiresAt: c.expires_at.toISOString(),
    maxPerVendor: c.max_per_vendor,
    codeCount: codeCount ?? c._count?.vouchers ?? 0,
    createdAt: c.created_at.toISOString(),
  };
}

function requireStaff(actor: ScopeActor) {
  if (!actor.roles.some(r => ['super_admin', 'admin'].includes(r))) {
    throw new AppError(403, 'Not authorized to manage voucher campaigns');
  }
}

function requireSuperAdmin(actor: ScopeActor) {
  if (!actor.roles.includes('super_admin')) throw new AppError(403, 'Only a super admin can manage voucher campaigns');
}

function randomSuffix(): string {
  let out = '';
  for (let i = 0; i < CODE_RANDOM_LEN; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export async function createCampaign(actor: ScopeActor, raw: unknown): Promise<{ campaign: VoucherCampaign; codes: string[] }> {
  requireSuperAdmin(actor);
  const input = createCampaignSchema.parse(raw);
  const starts = new Date(input.startsAt);
  const expires = new Date(input.expiresAt);
  if (expires.getTime() <= Date.now()) throw new AppError(400, 'Expiry must be in the future');

  // Generate collision-free codes in batches before writing anything.
  const needed = input.codeCount;
  const picked = new Set<string>();
  for (let round = 0; round < 5 && picked.size < needed; round++) {
    const batch = new Set<string>();
    while (batch.size < (needed - picked.size) * 2 + 10) batch.add(`${input.codePrefix}-${randomSuffix()}`);
    const taken = await prisma.vouchers.findMany({
      where: { code: { in: [...batch, ...picked] } }, select: { code: true },
    });
    const takenSet = new Set(taken.map(t => t.code));
    for (const code of batch) {
      if (picked.size >= needed) break;
      if (!takenSet.has(code)) picked.add(code);
    }
  }
  if (picked.size < needed) throw new AppError(500, 'Could not generate enough unique codes — try a longer prefix');

  const codes = [...picked];
  const fixed = input.discountType === 'fixed';
  const result = await prisma.$transaction(async tx => {
    const campaign = await tx.voucher_campaigns.create({
      data: {
        name: input.name.trim(), code_prefix: input.codePrefix, status: 'active',
        discount_type: input.discountType,
        discount_amount: fixed ? input.discountAmount! : 0,
        discount_percent: fixed ? null : input.discountPercent!,
        max_discount: input.maxDiscount ?? null,
        minimum_charge: input.minimumCharge,
        starts_at: starts, expires_at: expires,
        max_per_vendor: input.maxPerVendor,
        created_by: actor.id,
      },
    });
    await tx.vouchers.createMany({
      data: codes.map(code => ({
        code, title: input.title.trim(), description: input.description.trim(),
        discount_type: input.discountType,
        discount_amount: fixed ? input.discountAmount! : 0,
        discount_percent: fixed ? null : input.discountPercent!,
        max_discount: input.maxDiscount ?? null,
        minimum_charge: input.minimumCharge,
        starts_at: starts, expires_at: expires,
        claim_limit: 1, is_active: true, is_listed: false,
        campaign_id: campaign.id, created_by: actor.id,
      })),
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id, entity_type: 'voucher_campaign', entity_id: campaign.id,
        action: 'VOUCHER_CAMPAIGN_CREATED',
        new_data: { name: campaign.name, codePrefix: campaign.code_prefix, codeCount: codes.length },
      },
    });
    return campaign;
  });
  return { campaign: toCampaign(result, codes.length), codes };
}

export async function listCampaigns(actor: ScopeActor, page = 1) {
  requireStaff(actor);
  const take = 20;
  const [total, rows] = await Promise.all([
    prisma.voucher_campaigns.count(),
    prisma.voucher_campaigns.findMany({
      orderBy: [{ created_at: 'desc' }], skip: (page - 1) * take, take,
      include: { _count: { select: { vouchers: true } } },
    }),
  ]);
  const stats = await campaignStats(rows.map(r => r.id));
  return {
    data: rows.map(r => ({ ...toCampaign(r), stats: stats.get(r.id)! })),
    page, totalPages: Math.max(1, Math.ceil(total / take)), total,
  };
}

export async function getCampaign(actor: ScopeActor, campaignId: string) {
  requireStaff(actor);
  const row = await prisma.voucher_campaigns.findUnique({
    where: { id: z.uuid().parse(campaignId) },
    include: { _count: { select: { vouchers: true } } },
  }).catch(() => null);
  if (!row) throw new AppError(404, 'Campaign not found');
  const stats = await campaignStats([row.id]);
  return { ...toCampaign(row), stats: stats.get(row.id)! };
}

/** Per-campaign aggregates: generated / claimed / redeemed / expired. */
export async function campaignStats(ids: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>(ids.map(id => [id, { generated: 0, claimed: 0, redeemed: 0, expired: 0 }]));
  if (!ids.length) return out;
  const now = new Date();
  // voucher_claims has no Prisma-level relation to vouchers (scalar
  // voucher_id only), so the redeemed count joins in JS, not in the query.
  const vouchersById = await prisma.vouchers.findMany({ where: { campaign_id: { in: ids } }, select: { id: true, campaign_id: true } });
  const campaignOf = new Map(vouchersById.map(v => [v.id, v.campaign_id as string]));
  const [counts, claimedSums, expiredCounts, usedClaims] = await Promise.all([
    prisma.vouchers.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids } }, _count: { id: true } }),
    prisma.vouchers.groupBy({
      by: ['campaign_id'], where: { campaign_id: { in: ids } }, _sum: { claimed_count: true },
    }),
    prisma.vouchers.groupBy({
      by: ['campaign_id'],
      where: { campaign_id: { in: ids }, claimed_count: 0, expires_at: { lte: now } },
      _count: { id: true },
    }),
    vouchersById.length
      ? prisma.voucher_claims.findMany({
          where: { state: 'used', voucher_id: { in: vouchersById.map(v => v.id) } },
          select: { voucher_id: true },
        })
      : [],
  ]);
  for (const g of counts) {
    if (g.campaign_id) out.get(g.campaign_id)!.generated = g._count.id;
  }
  for (const s of claimedSums) {
    if (s.campaign_id) out.get(s.campaign_id)!.claimed = s._sum.claimed_count ?? 0;
  }
  for (const e of expiredCounts) {
    if (e.campaign_id) out.get(e.campaign_id)!.expired = e._count.id;
  }
  for (const u of usedClaims) {
    const cid = campaignOf.get(u.voucher_id);
    if (cid) out.get(cid)!.redeemed += 1;
  }
  return out;
}

type CodeRow = {
  id: string; code: string; title: string; description: string;
  is_active: boolean; expires_at: Date;
  claim_state: string | null; claimed_at: Date | null;
  business_name: string | null; client_name: string | null;
};

function toCodeState(r: CodeRow, now: number): CampaignCodeState {
  if (!r.is_active) return 'paused';
  if (!r.claim_state) return r.expires_at.getTime() <= now ? 'expired' : 'unclaimed';
  return r.claim_state === 'used' ? 'redeemed' : 'claimed';
}

export async function listCampaignCodes(
  actor: ScopeActor, campaignId: string,
  opts: { page?: number; q?: string | undefined; state?: string | undefined } = {},
): Promise<{ data: CampaignCodeRow[]; page: number; totalPages: number; total: number }> {
  requireStaff(actor);
  const id = z.uuid().parse(campaignId);
  const campaign = await prisma.voucher_campaigns.findUnique({ where: { id }, select: { id: true } });
  if (!campaign) throw new AppError(404, 'Campaign not found');
  const page = Math.max(1, opts.page ?? 1);
  const take = 50;
  const q = (opts.q ?? '').trim().toUpperCase();
  const state = opts.state && opts.state !== 'all' ? opts.state : null;
  if (state && !['unclaimed', 'claimed', 'redeemed', 'expired', 'paused'].includes(state)) {
    throw new AppError(400, 'Unknown code state');
  }
  // One joined query keeps the state filter and pagination consistent.
  const stateSql = state === 'paused' ? Prisma.sql`AND v.is_active = false`
    : state === 'redeemed' ? Prisma.sql`AND c.state = 'used'`
    : state === 'claimed' ? Prisma.sql`AND c.state IN ('claimed','reserved')`
    : state === 'expired' ? Prisma.sql`AND c.id IS NULL AND v.expires_at <= now()`
    : state === 'unclaimed' ? Prisma.sql`AND c.id IS NULL AND v.expires_at > now()`
    : Prisma.empty;
  const qSql = q ? Prisma.sql`AND v.code LIKE ${'%' + q.replace(/[%_]/g, '') + '%'}` : Prisma.empty;
  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<CodeRow[]>`
      SELECT v.id, v.code, v.title, v.description, v.is_active, v.expires_at,
             c.state AS claim_state, c.claimed_at,
             ven.business_name, ven.client_name
      FROM vouchers v
      LEFT JOIN voucher_claims c ON c.voucher_id = v.id
      LEFT JOIN vendors ven ON ven.id = c.vendor_id
      WHERE v.campaign_id = ${id}::uuid ${qSql} ${stateSql}
      ORDER BY v.code ASC LIMIT ${take} OFFSET ${(page - 1) * take}`,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM vouchers v
      LEFT JOIN voucher_claims c ON c.voucher_id = v.id
      WHERE v.campaign_id = ${id}::uuid ${qSql} ${stateSql}`,
  ]);
  const now = Date.now();
  const total = Number(counted[0]?.total ?? 0);
  return {
    data: rows.map(r => ({
      id: r.id, code: r.code, title: r.title, description: r.description, isActive: r.is_active,
      state: toCodeState(r, now),
      vendorName: r.claim_state ? (r.business_name ?? r.client_name ?? null) : null,
      claimedAt: r.claimed_at ? new Date(r.claimed_at).toISOString() : null,
      expiresAt: new Date(r.expires_at).toISOString(),
    })),
    page, totalPages: Math.max(1, Math.ceil(total / take)), total,
  };
}

export async function setCampaignStatus(actor: ScopeActor, campaignId: string, status: string) {
  requireSuperAdmin(actor);
  if (!(CAMPAIGN_STATUS as readonly string[]).includes(status)) throw new AppError(400, 'Unknown campaign status');
  const id = z.uuid().parse(campaignId);
  const current = await prisma.voucher_campaigns.findUnique({ where: { id } });
  if (!current) throw new AppError(404, 'Campaign not found');
  if (current.status === 'ended' && status !== 'ended') {
    throw new AppError(400, 'An ended campaign cannot be reopened — create a follow-up campaign instead');
  }
  const updated = await prisma.voucher_campaigns.update({ where: { id }, data: { status } });
  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id, entity_type: 'voucher_campaign', entity_id: id,
      action: status === 'active' ? 'VOUCHER_CAMPAIGN_ACTIVATED' : status === 'paused' ? 'VOUCHER_CAMPAIGN_PAUSED' : 'VOUCHER_CAMPAIGN_ENDED',
    },
  });
  const stats = await campaignStats([id]);
  return { ...toCampaign(updated), stats: stats.get(id)! };
}

/** Full code list for CSV export (caps at 10k rows — campaigns max out at 5k codes). */
export async function campaignCodesCsv(actor: ScopeActor, campaignId: string): Promise<{ filename: string; csv: string }> {
  requireStaff(actor);
  const id = z.uuid().parse(campaignId);
  const campaign = await prisma.voucher_campaigns.findUnique({ where: { id } });
  if (!campaign) throw new AppError(404, 'Campaign not found');
  const rows = await prisma.$queryRaw<CodeRow[]>`
    SELECT v.id, v.code, v.title, v.description, v.is_active, v.expires_at,
           c.state AS claim_state, c.claimed_at,
           ven.business_name, ven.client_name
    FROM vouchers v
    LEFT JOIN voucher_claims c ON c.voucher_id = v.id
    LEFT JOIN vendors ven ON ven.id = c.vendor_id
    WHERE v.campaign_id = ${id}::uuid
    ORDER BY v.code ASC LIMIT 10000`;
  const now = Date.now();
  const esc = (v: string | null) => (v === null ? '' : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['code,state,vendor,claimed_at,expires_at'];
  for (const r of rows) {
    lines.push([
      r.code, toCodeState(r, now),
      esc(r.claim_state ? (r.business_name ?? r.client_name ?? '') : ''),
      r.claimed_at ? new Date(r.claimed_at).toISOString() : '',
      new Date(r.expires_at).toISOString(),
    ].join(','));
  }
  return { filename: `${campaign.code_prefix.toLowerCase()}-codes.csv`, csv: lines.join('\n') };
}
