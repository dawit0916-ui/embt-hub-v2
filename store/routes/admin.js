import { Router } from 'express';
import { cfg } from '../config.js';
import { ObjectId, col, getClient } from '../db.js';
import { credit, writeLedger } from '../economy.js';
import { AppError, needInt, needPackage, needString, safeEqual, wrap } from '../util.js';

export const adminRoutes = Router();

adminRoutes.use('/admin', (req, _res, next) => {
  if (!safeEqual(req.headers['x-admin-token'] || '', cfg.adminToken)) return next(new AppError(401, 'unauthorized'));
  next();
});

const ACCESS = new Set(['free', 'login', 'paid']);
const ROLES = new Set(['base', 'feature', 'config', 'universal']);
const HEX64 = /^[0-9a-f]{64}$/;

/** Create or update an app listing. */
adminRoutes.post(
  '/admin/apps',
  wrap(async (req, res) => {
    const b = req.body ?? {};
    const packageId = needPackage(b.packageId);
    if (!ACCESS.has(b.access)) throw new AppError(400, 'bad_access');
    const price = b.access === 'paid' ? needInt(b.price, 'price', { min: 1 }) : 0;
    await col('apps').updateOne(
      { _id: packageId },
      {
        $set: {
          name: needString(b.name, 'name', 100),
          iconUrl: typeof b.iconUrl === 'string' ? b.iconUrl.slice(0, 500) : '',
          screenshots: Array.isArray(b.screenshots) ? b.screenshots.slice(0, 10).map(String) : [],
          description: typeof b.description === 'string' ? b.description.slice(0, 5000) : '',
          category: typeof b.category === 'string' ? b.category.slice(0, 50) : '',
          access: b.access,
          price,
          hidden: b.hidden === true,
        },
        $setOnInsert: { latestVersionCode: 0 },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  })
);

/**
 * Register a release. Files carry the GitHub asset id plus the sha256/size you get from
 * `npm run hash`. Each file has a unique key (for example "base", "feature_editor",
 * "config_arm64_v8a", "universal").
 */
adminRoutes.post(
  '/admin/versions',
  wrap(async (req, res) => {
    const b = req.body ?? {};
    const packageId = needPackage(b.packageId);
    const versionCode = needInt(b.versionCode, 'versionCode', { min: 1 });
    if (!(await col('apps').findOne({ _id: packageId }, { projection: { _id: 1 } }))) {
      throw new AppError(404, 'app_not_found', 'Create the app first');
    }
    if (!Array.isArray(b.files) || b.files.length === 0 || b.files.length > 60) throw new AppError(400, 'bad_files');
    const keys = new Set();
    const files = b.files.map((f) => {
      const key = needString(f?.key, 'file.key', 100);
      if (keys.has(key)) throw new AppError(400, 'duplicate_key', key);
      keys.add(key);
      if (!ROLES.has(f.role)) throw new AppError(400, 'bad_role', key);
      const sha256 = String(f.sha256 ?? '').toLowerCase();
      if (!HEX64.test(sha256)) throw new AppError(400, 'bad_sha256', key);
      return {
        key,
        role: f.role,
        splitName: typeof f.splitName === 'string' ? f.splitName : '',
        configFor: typeof f.configFor === 'string' ? f.configFor : '',
        requires: Array.isArray(f.requires) ? f.requires.map(String) : [],
        assetId: needInt(f.assetId, 'file.assetId', { min: 1 }),
        sha256,
        size: needInt(f.size, 'file.size', { min: 1 }),
      };
    });
    const hasBase = files.some((f) => f.role === 'base') || files.some((f) => f.role === 'universal');
    if (!hasBase) throw new AppError(400, 'no_base', 'Need a base or universal file');

    try {
      await col('versions').insertOne({
        packageId,
        versionCode,
        versionName: needString(b.versionName, 'versionName', 50),
        changelog: typeof b.changelog === 'string' ? b.changelog.slice(0, 5000) : '',
        files,
        createdAt: new Date(),
      });
    } catch (e) {
      if (e?.code === 11000) throw new AppError(409, 'version_exists');
      throw e;
    }
    await col('apps').updateOne({ _id: packageId }, { $max: { latestVersionCode: versionCode } });
    res.json({ ok: true });
  })
);

adminRoutes.get(
  '/admin/refunds',
  wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending_review';
    const list = await col('refunds').find({ status }).sort({ createdAt: 1 }).limit(100).toArray();
    res.json({ refunds: list });
  })
);

async function decide(req, res, approve) {
  if (!ObjectId.isValid(req.params.id)) throw new AppError(400, 'bad_refund');
  const _id = new ObjectId(req.params.id);
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : '';
  const session = getClient().startSession();
  try {
    await session.withTransaction(async () => {
      const r = await col('refunds').findOneAndUpdate(
        { _id, status: 'pending_review' },
        { $set: { status: approve ? 'approved' : 'rejected', note, decidedAt: new Date() } },
        { session }
      );
      if (!r) throw new AppError(409, 'not_pending');
      if (approve) {
        if (!(await credit(r.userId, r.price, `Store refund: ${r.packageId}`, `store_refund_${r.packageId}`, session))) {
          throw new AppError(409, 'user_missing');
        }
        await writeLedger(
          { userId: r.userId, delta: r.price, reason: 'refund', packageId: r.packageId, refundId: _id },
          session
        );
        await col('licenses').updateOne(
          { userId: r.userId, packageId: r.packageId },
          { $set: { status: 'revoked' } },
          { session }
        );
      } else {
        await col('licenses').updateOne(
          { userId: r.userId, packageId: r.packageId, status: 'disputed' },
          { $set: { status: 'active' } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
  res.json({ ok: true });
}

adminRoutes.post('/admin/refunds/:id/approve', wrap((req, res) => decide(req, res, true)));
adminRoutes.post('/admin/refunds/:id/reject', wrap((req, res) => decide(req, res, false)));
