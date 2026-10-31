import { Router } from 'express';
import { ObjectId, col } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError, wrap } from '../util.js';

export const deliveriesRoutes = Router();

const STAGES = new Set([
  'download_complete',
  'hash_verified',
  'hash_failed',
  'install_started',
  'install_success',
  'install_failed',
  'install_cancelled',
]);

/**
 * The app reports each step. These reports come from the client, so they are evidence for
 * refund review, never proof. Detail is capped so nobody can stuff the database.
 */
deliveriesRoutes.post(
  '/deliveries/:id/stage',
  requireAuth,
  wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) throw new AppError(400, 'bad_delivery');
    const stage = String(req.body?.stage ?? '');
    if (!STAGES.has(stage)) throw new AppError(400, 'bad_stage');
    const d = req.body?.detail ?? {};
    const detail = {
      status: Number.isInteger(d.status) ? d.status : null,
      message: typeof d.message === 'string' ? d.message.slice(0, 300) : '',
      failedSplit: typeof d.failedSplit === 'string' ? d.failedSplit.slice(0, 100) : '',
      android: Number.isInteger(d.android) ? d.android : null,
    };
    const r = await col('deliveries').updateOne(
      { _id: new ObjectId(req.params.id), userId: req.user.id },
      { $push: { stages: { $each: [{ stage, at: new Date(), detail }], $slice: -80 } } }
    );
    if (r.matchedCount !== 1) throw new AppError(404, 'delivery_not_found');
    res.json({ ok: true });
  })
);
