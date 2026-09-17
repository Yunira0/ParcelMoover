import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/authorizeRoles.middleware';
import { csrfProtection } from '../middlewares/csrf.middleware';
import { rateLimit } from 'express-rate-limit';
import {
  campaignCodesCsv, createCampaign, getCampaign,
  listCampaignCodes, listCampaigns, setCampaignStatus,
} from '../services/voucher-campaign.service';

const router = Router();
// Campaign management is office tooling: staff only, writes super_admin only
// (enforced in the service). Reads ride on the staff session like the offers list.
router.use(authMiddleware, authorizeRoles('super_admin', 'admin'));
router.use(rateLimit({
  windowMs: 60000, limit: 60, keyGenerator: req => req.user!.id,
  standardHeaders: true, legacyHeaders: false,
}));

// GET /api/voucher-campaigns — campaign directory with live stats.
router.get('/', async (req, res, next) => {
  try {
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    res.json({ success: true, data: await listCampaigns(req.user!, page) });
  } catch (e) { next(e); }
});

router.post('/', csrfProtection, async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await createCampaign(req.user!, req.body) }); }
  catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try { res.json({ success: true, data: await getCampaign(req.user!, z.string().parse(req.params.id)) }); }
  catch (e) { next(e); }
});

router.patch('/:id/status', csrfProtection, async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.string() }).parse(req.body);
    res.json({ success: true, data: await setCampaignStatus(req.user!, z.string().parse(req.params.id), status) });
  } catch (e) { next(e); }
});

// GET /api/voucher-campaigns/:id/codes — generated codes with claim tracking.
router.get('/:id/codes', async (req, res, next) => {
  try {
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    res.json({ success: true, data: await listCampaignCodes(req.user!, z.string().parse(req.params.id), { page, q, state }) });
  } catch (e) { next(e); }
});

// GET /api/voucher-campaigns/:id/codes.csv — full code list for records/reprint.
router.get('/:id/codes.csv', async (req, res, next) => {
  try {
    const { filename, csv } = await campaignCodesCsv(req.user!, z.string().parse(req.params.id));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) { next(e); }
});

export default router;
