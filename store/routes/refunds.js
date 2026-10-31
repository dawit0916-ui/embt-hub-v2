import { Router } from 'express';
import { cfg } from '../config.js';
import { ObjectId, col, getClient } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError, needString, wrap } from '../util.js';

export const refundRoutes = Router();

/**
 * Refund request for a failed delivery. Eligible only if the license never reached
 * install_success. Tokens stay deducted and the license is "disputed" until an admin decides.
 */
refundRoutes.post(
  '/refunds',
  requireAuth,
  wrap(async (req, res) => {
    const userId = req.user.id;
    const idStr = needString(req.body?.deliveryId, 'deliveryId', 40);
    if (!ObjectId.isValid(idStr)) throw new AppError(400, 'bad_delivery');
    const delivery = await col('deliveries').findOne({ _id: new ObjectId(idStr), userId });
    if (!delivery) throw new AppError(404, 'delivery_not_found');
    const { packageId } = delivery;

    const purchase = await col('purchases').findOne(
      { userId, packageId, status: 'completed' },
      { sort: { completedAt: -1 } }
    );
    if (!purchase) throw new AppError(400, 'not_refundable', 'Only purchased apps can be refunded');
    const lic = await col('licenses').findOne({ userId, packageId });
    if (!lic || lic.status !== 'active') throw new AppError(409, 'not_refundable', 'License is not active');

    const installed = await col('deliveries').findOne({
      userId,
      packageId,
      'stages.stage': 'install_success',
    });
    if (installed) throw new AppError(409, 'already_installed', 'This app was installed successfully');

    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recent = await col('refunds').countDocuments({ userId, createdAt: { $gte: since } });
    if (recent >= cfg.maxRefunds30d) throw new AppError(429, 'refund_limit');

    const session = getClient().startSession();
    let refundId;
    try {
      await session.withTransaction(async () => {
        const flip = await col('licenses').updateOne(
          { userId, packageId, status: 'active' },
          { $set: { status: 'disputed' } },
          { session }
        );
        if (flip.modifiedCount !== 1) throw new AppError(409, 'refund_pending');
        const r = await col('refunds').insertOne(
          {
            userId,
            packageId,
            purchaseId: purchase._id,
            deliveryId: delivery._id,
            price: purchase.price,
            status: 'pending_review',
            evidence: { stages: delivery.stages, versionCode: delivery.versionCode },
            createdAt: new Date(),
          },
          { session }
        );
        refundId = r.insertedId;
      });
    } finally {
      await session.endSession();
    }
    res.json({ refundId: String(refundId), status: 'pending_review' });
  })
);
