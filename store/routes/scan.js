import { Router } from 'express';
import { col } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError, PACKAGE_RE, wrap } from '../util.js';

export const scanRoutes = Router();

const STATUSES = new Set(['ok', 'update_available', 'modified', 'wrong_key', 'missing_files', 'unlisted']);

/**
 * The on-device scan runs locally. Only YOUR apps' results are reported here
 * (package id, version, status), never the full list of installed apps.
 */
scanRoutes.post(
  '/scan/report',
  requireAuth,
  wrap(async (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length > 100) throw new AppError(400, 'bad_items');
    const ops = [];
    for (const it of items) {
      if (typeof it?.packageId !== 'string' || !PACKAGE_RE.test(it.packageId)) continue;
      if (!STATUSES.has(it.status)) continue;
      ops.push({
        updateOne: {
          filter: { userId: req.user.id, deviceHash: req.user.deviceHash, packageId: it.packageId },
          update: {
            $set: {
              versionCode: Number.isInteger(it.versionCode) ? it.versionCode : null,
              status: it.status,
              at: new Date(),
            },
          },
          upsert: true,
        },
      });
    }
    if (ops.length) await col('scans').bulkWrite(ops, { ordered: false });
    res.json({ ok: true, stored: ops.length });
  })
);
