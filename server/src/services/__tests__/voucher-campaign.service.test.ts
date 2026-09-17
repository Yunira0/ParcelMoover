import { beforeEach, describe, expect, it, vi } from 'vitest';
const { db } = vi.hoisted(() => ({ db: {
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  vouchers: { createMany: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  voucher_claims: { findMany: vi.fn(), count: vi.fn() },
  voucher_campaigns: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  audit_logs: { create: vi.fn() },
} }));
vi.mock('../../lib/prisma', () => ({ default: db }));
import {
  campaignCodesCsv, createCampaign, createCampaignSchema,
  getCampaign, listCampaignCodes, listCampaigns, setCampaignStatus,
} from '../voucher-campaign.service';

const admin = { id: 'admin', roles: ['super_admin'] };
const campId = '11111111-1111-4111-8111-111111111111';
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const terms = () => ({ title: 'Dashain 20% off', description: 'Dashain campaign: 20% off one delivery order',
  discountType: 'percent' as const, discountPercent: 20, maxDiscount: 200, minimumCharge: 300,
  startsAt: future(0.01), expiresAt: future(30) });
const input = () => ({ name: 'Dashain 2083', codePrefix: 'DASH', codeCount: 100, maxPerVendor: 1, ...terms() });
const campaignRow = (overrides = {}) => ({ id: 'camp1', name: 'Dashain 2083', code_prefix: 'DASH', status: 'active',
  discount_type: 'percent', discount_amount: 0, discount_percent: 20, max_discount: 200,
  minimum_charge: 300, starts_at: new Date(), expires_at: new Date(Date.now() + 86400000),
  max_per_vendor: 1, created_by: 'admin', created_at: new Date(), ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(fn => fn(db));
  db.vouchers.findMany.mockResolvedValue([]);
  db.vouchers.groupBy.mockResolvedValue([]);
  db.voucher_claims.findMany.mockResolvedValue([]);
  db.voucher_campaigns.count.mockResolvedValue(0);
  db.voucher_campaigns.findMany.mockResolvedValue([]);
  db.voucher_campaigns.findUnique.mockResolvedValue({ id: 'camp1' });
});

describe('campaign creation', () => {
  it('validates the campaign envelope on top of the offer terms', () => {
    expect(createCampaignSchema.safeParse(input()).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...input(), codePrefix: 'dash!' }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...input(), codeCount: 0 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...input(), codeCount: 5001 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...input(), name: 'AB' }).success).toBe(false);
  });
  it('rejects non-super-admin creators', async () => {
    await expect(createCampaign({ id: 'x', roles: ['admin'] }, input())).rejects.toThrow('super admin');
    expect(db.voucher_campaigns.create).not.toHaveBeenCalled();
  });
  it('creates the campaign plus unique unlisted single-claim codes in one transaction', async () => {
    db.voucher_campaigns.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'camp1', created_at: new Date(), ...data }));
    const { campaign, codes } = await createCampaign(admin, input());
    expect(campaign.name).toBe('Dashain 2083');
    expect(campaign.codeCount).toBe(100);
    expect(new Set(codes).size).toBe(100);
    expect(codes.every(c => /^DASH-[A-Z2-9]{6}$/.test(c))).toBe(true);
    expect(db.vouchers.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ campaign_id: 'camp1', claim_limit: 1, is_listed: false, is_active: true }),
    ]) });
    expect(db.vouchers.createMany.mock.calls[0]![0].data).toHaveLength(100);
    expect(db.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'VOUCHER_CAMPAIGN_CREATED' }),
    }));
  });
});

describe('campaign reads', () => {
  it('lists campaigns with stats and pages', async () => {
    db.voucher_campaigns.count.mockResolvedValue(3);
    db.voucher_campaigns.findMany.mockResolvedValue([
      { ...campaignRow(), _count: { vouchers: 100 } },
      { ...campaignRow({ id: 'camp2', status: 'paused' }), _count: { vouchers: 50 } },
    ]);
    db.vouchers.groupBy
      .mockResolvedValueOnce([{ campaign_id: 'camp1', _count: { id: 100 } }, { campaign_id: 'camp2', _count: { id: 50 } }])
      .mockResolvedValueOnce([{ campaign_id: 'camp1', _sum: { claimed_count: 40 } }])
      .mockResolvedValueOnce([]);
    db.vouchers.findMany.mockResolvedValue([
      { id: 'v1', campaign_id: 'camp1' }, { id: 'v2', campaign_id: 'camp2' },
    ]);
    const res = await listCampaigns(admin, 1);
    expect(res.total).toBe(3);
    expect(res.data[0]!).toMatchObject({ id: 'camp1', stats: { generated: 100, claimed: 40, redeemed: 0, expired: 0 } });
    expect(res.data[1]!.status).toBe('paused');
  });
  it('filters codes by state derived from claims and expiry', async () => {
    db.voucher_campaigns.findUnique.mockResolvedValue({ id: 'camp1' });
    db.$queryRaw
      .mockResolvedValueOnce([{ id: 'v1', code: 'DASH-AAAAAA', is_active: true, expires_at: new Date(Date.now() + 86400000),
        claim_state: 'claimed', claimed_at: new Date(), business_name: 'Shop', client_name: 'Shop' }])
      .mockResolvedValueOnce([{ total: BigInt(1) }]);
    const res = await listCampaignCodes(admin, campId, { state: 'claimed' });
    expect(res.total).toBe(1);
    expect(res.data[0]!).toMatchObject({ code: 'DASH-AAAAAA', state: 'claimed', vendorName: 'Shop' });
    // One query for the page, one for the filtered total.
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it('exports codes as CSV', async () => {
    db.voucher_campaigns.findUnique.mockResolvedValue({ id: 'camp1', code_prefix: 'DASH' });
    db.$queryRaw.mockResolvedValue([
      { id: 'v1', code: 'DASH-AAAAAA', is_active: true, expires_at: new Date('2026-10-01'), claim_state: null, claimed_at: null, business_name: null, client_name: null },
    ]);
    const { filename, csv } = await campaignCodesCsv(admin, campId);
    expect(filename).toBe('dash-codes.csv');
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toMatch(/^code,state,vendor,claimed_at,expires_at\nDASH-AAAAAA,unclaimed,,,/);
  });
});

describe('campaign status', () => {
  it('pauses and resumes, but never reopens an ended campaign', async () => {
    db.voucher_campaigns.findUnique.mockResolvedValue(campaignRow());
    db.voucher_campaigns.update.mockImplementation(({ data }: any) => Promise.resolve(campaignRow(data)));
    expect((await setCampaignStatus(admin, campId, 'paused')).status).toBe('paused');
    db.voucher_campaigns.findUnique.mockResolvedValue(campaignRow({ status: 'ended' }));
    await expect(setCampaignStatus(admin, campId, 'active')).rejects.toThrow('reopened');
  });
  it('fetches a single campaign with stats', async () => {
    db.voucher_campaigns.findUnique.mockResolvedValue({ ...campaignRow(), _count: { vouchers: 100 } });
    expect((await getCampaign(admin, campId)).codePrefix).toBe('DASH');
  });
});
