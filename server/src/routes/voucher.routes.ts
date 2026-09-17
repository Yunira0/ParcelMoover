import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/authorizeRoles.middleware';
import { requireStaffPermission } from '../middlewares/staffPermission.middleware';
import { csrfProtection } from '../middlewares/csrf.middleware';
import { rateLimit } from 'express-rate-limit';
import {
  claimVoucher, createVoucher, listAllVouchers, listAvailableVouchers,
  listMyVouchers, setVoucherActive,
} from '../services/voucher.service';

const router = Router();
// Claiming and spending happen inside the order-creation flow, so vendor staff
// are gated on ORDER_ACCESS (the same grant that lets them open Create Order),
// not FINANCE_ACCESS.
router.use(authMiddleware, authorizeRoles('super_admin', 'admin', 'vendor', 'vendor_staff'), requireStaffPermission('ORDER_ACCESS'));
router.use(rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => req.user!.id,
  standardHeaders: true, legacyHeaders: false }));

// GET /api/vouchers — staff see every offer (paginated); vendors see live
// browse cards with their own claim state.
router.get('/', async (req, res, next) => {
  try {
    const roles = req.user!.roles;
    if (roles.some(r => ['super_admin', 'admin'].includes(r))) {
      const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
      res.json({ success: true, data: await listAllVouchers(req.user!, page) });
    } else {
      res.json({ success: true, data: await listAvailableVouchers(req.user!) });
    }
  } catch (e) { next(e); }
});

// GET /api/vouchers/mine — "My Vouchers". Staff may pass ?vendorId to preview
// the vouchers of the vendor they are keying an order in for.
router.get('/mine', async (req, res, next) => {
  try {
    const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
    res.json({ success: true, data: await listMyVouchers(req.user!, vendorId) });
  } catch (e) { next(e); }
});

router.post('/', csrfProtection, authorizeRoles('super_admin'), async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await createVoucher(req.user!, req.body) }); }
  catch (e) { next(e); }
});

router.patch('/:id', csrfProtection, authorizeRoles('super_admin'), async (req, res, next) => {
  try {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    const voucherId = z.uuid().parse(req.params.id);
    res.json({ success: true, data: await setVoucherActive(req.user!, voucherId, isActive) });
  } catch (e) { next(e); }
});

router.post('/claim', csrfProtection, authorizeRoles('vendor', 'vendor_staff'), async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await claimVoucher(req.user!, req.body) }); }
  catch (e) { next(e); }
});

export default router;
