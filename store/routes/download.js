import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ObjectId, col } from '../db.js';
import { requireAuth } from '../auth.js';
import { assetUrl } from '../github.js';
import { AppError, needInt, needPackage, wrap } from '../util.js';

export const downloadRoutes = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
});

/**
 * One call per file (base, a feature split, a config split, or the universal APK).
 * First call for an install attempt creates a delivery; pass ?delivery=<id> for the rest.
 * The license check happens HERE, on every request, not in the UI.
 */
downloadRoutes.get(
  '/download/:packageId/:versionCode/:fileKey',
  requireAuth,
  limiter,
  wrap(async (req, res) => {
    const packageId = needPackage(req.params.packageId);
    const versionCode = needInt(req.params.versionCode, 'versionCode');
    const fileKey = String(req.params.fileKey).slice(0, 100);
    const userId = req.user.id;

    const app = await col('apps').findOne({ _id: packageId, hidden: { $ne: true } });
    if (!app) throw new AppError(404, 'not_found');
    if (app.access === 'paid') {
      const lic = await col('licenses').findOne({ userId, packageId, status: 'active' });
      if (!lic) throw new AppError(403, 'not_owned', 'Purchase this app first');
    }

    const ver = await col('versions').findOne({ packageId, versionCode });
    const file = ver?.files?.find((f) => f.key === fileKey);
    if (!file) throw new AppError(404, 'not_found');

    const stage = { stage: 'url_issued', at: new Date(), file: fileKey };
    let deliveryId;
    if (req.query.delivery) {
      if (!ObjectId.isValid(String(req.query.delivery))) throw new AppError(400, 'bad_delivery');
      const r = await col('deliveries').updateOne(
        { _id: new ObjectId(String(req.query.delivery)), userId, packageId, versionCode },
        { $push: { stages: { $each: [stage], $slice: -80 } } }
      );
      if (r.matchedCount !== 1) throw new AppError(404, 'delivery_not_found');
      deliveryId = String(req.query.delivery);
    } else {
      const r = await col('deliveries').insertOne({
        userId,
        packageId,
        versionCode,
        deviceHash: req.user.deviceHash,
        createdAt: new Date(),
        stages: [stage],
      });
      deliveryId = String(r.insertedId);
    }

    const url = await assetUrl(file.assetId);
    res.set('Cache-Control', 'no-store');
    res.json({ deliveryId, url, sha256: file.sha256, size: file.size, expiresInSec: 60 });
  })
);
