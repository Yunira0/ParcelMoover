import { beforeEach, describe, expect, it, vi } from 'vitest';
const { db } = vi.hoisted(() => ({ db: {
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  vouchers: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  voucher_claims: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  voucher_events: { create: vi.fn() },
  vendors: { findFirst: vi.fn() }, vendor_staff: { findFirst: vi.fn() },
  audit_logs: { findFirst: vi.fn(), create: vi.fn() },
  vendor_kyc_applications: { findFirst: vi.fn() },
} }));
vi.mock('../../lib/prisma', () => ({ default: db }));
import {
  claimVoucher, createVoucher, createVoucherSchema,
  listAvailableVouchers, listMyVouchers, resolveVendorClaimTx,
  voucherDiscountForFee, voucherUsability,
} from '../voucher.service';

const vendorId = '3bda7ee0-108c-45c7-9ab4-21137a9dd68d';
const admin = { id: 'admin', roles: ['super_admin'] };
const vendor = { id: 'vendor-user', roles: ['vendor'] };
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const fixedInput = () => ({ code: 'MOVE100', title: 'Rs. 100 off', description: 'Rs. 100 off your next delivery order',
  discountType: 'fixed', discountAmount: 100, minimumCharge: 150, startsAt: future(0.01), expiresAt: future(30), claimLimit: 500 });

function offer(overrides = {}) {
  return { id: 'v1', code: 'MOVE100', title: 'Rs. 100 off', description: 'd',
    discount_type: 'fixed', discount_amount: 100, discount_percent: null, max_discount: null,
    minimum_charge: 150, starts_at: new Date(Date.now() - 1000), expires_at: new Date(Date.now() + 86400000),
    claim_limit: 500, claimed_count: 10, uses_per_vendor: 1, is_active: true, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(fn => fn(db));
  db.$queryRaw.mockResolvedValue([{ id: 'v1' }]);
  db.vendors.findFirst.mockResolvedValue({ id: vendorId });
  db.audit_logs.findFirst.mockResolvedValue({ entity_id: 'kyc-1' });
  db.vendor_kyc_applications.findFirst.mockResolvedValue({ id: 'kyc-1' });
  db.voucher_claims.findUnique.mockResolvedValue(null);
  db.voucher_claims.findFirst.mockResolvedValue(null);
  db.voucher_claims.count.mockResolvedValue(0);
});

describe('voucher creation rules', () => {
  it('rejects non-super-admin creators', async () => {
    for (const role of ['admin', 'vendor', 'vendor_staff', 'sales']) {
      await expect(createVoucher({ id: 'x', roles: [role] }, fixedInput())).rejects.toThrow('super admin');
    }
    expect(db.vouchers.create).not.toHaveBeenCalled();
  });
  it('normalizes codes to uppercase but rejects malformed ones', () => {
    expect(createVoucherSchema.safeParse({ ...fixedInput(), code: 'move100' }).success).toBe(true);
    for (const code of ['ab', 'MOVE 100', '-MOVE', 'a'.repeat(33)]) {
      expect(createVoucherSchema.safeParse({ ...fixedInput(), code }).success).toBe(false);
    }
  });
  it('requires the matching discount shape per type', () => {
    expect(createVoucherSchema.safeParse({ ...fixedInput(), discountAmount: undefined }).success).toBe(false);
    expect(createVoucherSchema.safeParse({ ...fixedInput(), discountType: 'percent', discountAmount: 100 }).success).toBe(false);
    expect(createVoucherSchema.safeParse({ ...fixedInput(), discountType: 'percent', discountAmount: undefined, discountPercent: 10, maxDiscount: 80 }).success).toBe(true);
    expect(createVoucherSchema.safeParse({ ...fixedInput(), discountType: 'percent', discountAmount: undefined, discountPercent: 101 }).success).toBe(false);
  });
  it('rejects inverted windows and past expiry', async () => {
    expect(createVoucherSchema.safeParse({ ...fixedInput(), startsAt: future(5), expiresAt: future(1) }).success).toBe(false);
    await expect(createVoucher({ ...admin }, { ...fixedInput(), expiresAt: future(-1), startsAt: future(-2) })).rejects.toThrow('future');
  });
  it('maps duplicate codes to 409 and audits creation', async () => {
    const { Prisma } = await import('../../generated/prisma/client');
    db.vouchers.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(createVoucher(admin, fixedInput())).rejects.toThrow('already exists');
    db.vouchers.create.mockResolvedValueOnce(offer());
    expect((await createVoucher(admin, fixedInput())).code).toBe('MOVE100');
    expect(db.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'VOUCHER_CREATED' }) }));
  });
});

describe('voucher discount math', () => {
  it('caps fixed discounts at the fee', () => {
    expect(voucherDiscountForFee({ discountType: 'fixed', discountAmount: 100, discountPercent: null, maxDiscount: null }, 150)).toBe(100);
    expect(voucherDiscountForFee({ discountType: 'fixed', discountAmount: 100, discountPercent: null, maxDiscount: null }, 60)).toBe(60);
  });
  it('applies percent with and without a cap', () => {
    const pct = { discountType: 'percent', discountAmount: 0, discountPercent: 10, maxDiscount: 80 };
    expect(voucherDiscountForFee(pct, 500)).toBe(50);
    expect(voucherDiscountForFee(pct, 1000)).toBe(80);
    expect(voucherDiscountForFee({ ...pct, maxDiscount: null }, 1000)).toBe(100);
  });
  it('explains why a claimed voucher is not usable', () => {
    const shaped = { id: 'v1', code: 'MOVE100', title: 't', description: 'd', discountType: 'fixed',
      discountAmount: 100, discountPercent: null, maxDiscount: null, minimumCharge: 0,
      startsAt: future(-1), expiresAt: future(1), claimLimit: 5, claimedCount: 1, usesPerVendor: 1, isActive: true, campaignId: null };
    expect(voucherUsability('claimed', shaped).usable).toBe(true);
    expect(voucherUsability('used', shaped).reason).toMatch('Already used');
    expect(voucherUsability('claimed', { ...shaped, isActive: false }).reason).toMatch('Paused');
    expect(voucherUsability('claimed', { ...shaped, expiresAt: future(-1) }).reason).toMatch('Expired');
    expect(voucherUsability('claimed', shaped, new Date(), false).reason).toMatch('Campaign paused');
  });
});

describe('voucher claiming', () => {
  it('pins claims to vendor accounts but does not require KYC', async () => {
    db.vendor_staff.findFirst.mockResolvedValue(null);
    await expect(claimVoucher({ id: 'x', roles: ['admin'] }, { code: 'MOVE100' })).rejects.toThrow('vendor accounts');
    expect(db.voucher_claims.create).not.toHaveBeenCalled();

    // No KYC application on file — claiming still goes through.
    db.audit_logs.findFirst.mockResolvedValue(null);
    db.vendor_kyc_applications.findFirst.mockResolvedValue(null);
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer());
    db.voucher_claims.create.mockResolvedValue({ id: 'c1', state: 'claimed', claimed_at: new Date() });
    expect((await claimVoucher(vendor, { code: 'MOVE100' })).claimId).toBe('c1');
  });
  it('rejects fully claimed offers and vendors at their per-vendor cap', async () => {
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer({ claimed_count: 500, claim_limit: 500 }));
    await expect(claimVoucher(vendor, { code: 'MOVE100' })).rejects.toThrow('fully claimed');

    // Default cap of one: a vendor with a claim already on file is done.
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer());
    db.voucher_claims.count.mockResolvedValue(1);
    await expect(claimVoucher(vendor, { code: 'MOVE100' })).rejects.toThrow('already used');
  });
  it('lets a vendor take a shared code up to its uses-per-vendor limit', async () => {
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer({ uses_per_vendor: 3 }));
    db.voucher_claims.create.mockResolvedValue({ id: 'c2', state: 'claimed', claimed_at: new Date() });

    db.voucher_claims.count.mockResolvedValue(2);
    expect((await claimVoucher(vendor, { code: 'MOVE100' })).claimId).toBe('c2');

    db.voucher_claims.count.mockResolvedValue(3);
    await expect(claimVoucher(vendor, { code: 'MOVE100' })).rejects.toThrow('3 uses per vendor');
  });
  it('claims, counts, logs the event and audits in one transaction', async () => {
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer());
    db.voucher_claims.create.mockResolvedValue({ id: 'c1', state: 'claimed', claimed_at: new Date() });
    const mine = await claimVoucher(vendor, { code: 'move100' });
    expect(mine.claimId).toBe('c1');
    expect(db.vouchers.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { claimed_count: { increment: 1 } } });
    expect(db.voucher_events.create).toHaveBeenCalledWith({ data: { claim_id: 'c1', kind: 'claim', discount: 0 } });
    expect(db.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'VOUCHER_CLAIMED' }) }));
  });
  it('claims a typed code at order time when the vendor has none', async () => {
    db.vouchers.findUnique.mockResolvedValue(offer());
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer());
    db.voucher_claims.create.mockResolvedValue({
      id: 'c1', state: 'claimed', claimed_at: new Date(), voucher_id: 'v1', vendor_id: vendorId,
    });
    const claim = await resolveVendorClaimTx(db as never, vendorId, 'vendor-user', { code: 'move100' });
    expect(claim.id).toBe('c1');
    expect(claim.state).toBe('claimed');
    expect(db.vouchers.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { claimed_count: { increment: 1 } } });
  });
  it('reuses an existing claim instead of claiming a code twice', async () => {
    db.vouchers.findUnique.mockResolvedValue(offer());
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer());
    db.voucher_claims.findFirst.mockResolvedValue({
      id: 'existing', state: 'claimed', claimed_at: new Date(), voucher_id: 'v1', vendor_id: vendorId,
    });
    const claim = await resolveVendorClaimTx(db as never, vendorId, 'vendor-user', { code: 'MOVE100' });
    expect(claim.id).toBe('existing');
    expect(db.voucher_claims.create).not.toHaveBeenCalled();
  });
  it('refuses a spent code once the vendor is at their cap', async () => {
    db.vouchers.findUnique.mockResolvedValue(offer());
    db.vouchers.findUniqueOrThrow.mockResolvedValue(offer());
    db.voucher_claims.findFirst.mockResolvedValue(null);
    db.voucher_claims.count.mockResolvedValue(1);
    await expect(resolveVendorClaimTx(db as never, vendorId, 'vendor-user', { code: 'MOVE100' }))
      .rejects.toThrow('already used');
  });
  it('lists browse cards with the vendor claim state and My Vouchers with usability', async () => {
    db.vouchers.findMany.mockResolvedValue([offer(), offer({ id: 'v2', code: 'SHIP50', claimed_count: 500, claim_limit: 500 })]);
    db.voucher_claims.findMany.mockResolvedValue([{ id: 'c1', voucher_id: 'v1', state: 'claimed' }]);
    const available = await listAvailableVouchers(vendor);
    expect(available).toHaveLength(1);
    expect(available[0]!.myClaim).toEqual({ id: 'c1', state: 'claimed' });
    expect(available[0]!.spotsLeft).toBe(490);
    db.voucher_claims.findMany.mockResolvedValue([{ id: 'c1', voucher_id: 'v1', vendor_id: vendorId, state: 'used', claimed_at: new Date() }]);
    const mine = await listMyVouchers(vendor);
    expect(mine[0]!.usable).toBe(false);
    expect(mine[0]!.unusableReason).toMatch('Already used');
  });
});
