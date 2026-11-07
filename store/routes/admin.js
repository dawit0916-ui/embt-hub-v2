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
    const set = {
      name: needString(b.name, 'name', 100),
      access: b.access,
      price,
    };
    // Only fields that were sent are changed, so registering a new version never wipes an icon or description.
    if (typeof b.iconUrl === 'string') set.iconUrl = b.iconUrl.slice(0, 500);
    if (Array.isArray(b.screenshots)) set.screenshots = b.screenshots.slice(0, 10).map(String);
    if (typeof b.description === 'string') set.description = b.description.slice(0, 5000);
    if (typeof b.category === 'string') set.category = b.category.slice(0, 50);
    if (typeof b.hidden === 'boolean') set.hidden = b.hidden;
    if (typeof b.featured === 'boolean') set.featured = b.featured;
    const defaults = { iconUrl: '', screenshots: [], description: '', category: '', hidden: false, featured: false };
    const onInsert = { latestVersionCode: 0 };
    for (const k of Object.keys(defaults)) {
      if (!(k in set)) onInsert[k] = defaults[k];
    }
    await col('apps').updateOne({ _id: packageId }, { $set: set, $setOnInsert: onInsert }, { upsert: true });
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
        default: f.default === false ? false : true,
      };
    });
    const minSdk = b.minSdk == null ? 0 : needInt(b.minSdk, 'minSdk', { min: 1, max: 100 });
    const targetSdk = b.targetSdk == null ? 0 : needInt(b.targetSdk, 'targetSdk', { min: 1, max: 100 });
    const signer = b.signer == null ? '' : String(b.signer).toLowerCase();
    if (signer && !HEX64.test(signer)) throw new AppError(400, 'bad_signer');
    const hasBase = files.some((f) => f.role === 'base') || files.some((f) => f.role === 'universal');
    if (!hasBase) throw new AppError(400, 'no_base', 'Need a base or universal file');

    try {
      await col('versions').insertOne({
        packageId,
        versionCode,
        versionName: needString(b.versionName, 'versionName', 50),
        changelog: typeof b.changelog === 'string' ? b.changelog.slice(0, 5000) : '',
        minSdk,
        targetSdk,
        signer,
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

/** Remove one version from the catalog. Does NOT touch the GitHub release files. */
adminRoutes.delete(
  '/admin/versions/:packageId/:versionCode',
  wrap(async (req, res) => {
    const packageId = needPackage(req.params.packageId);
    const versionCode = needInt(req.params.versionCode, 'versionCode');
    const r = await col('versions').deleteOne({ packageId, versionCode });
    const top = await col('versions').find({ packageId }).sort({ versionCode: -1 }).limit(1).toArray();
    await col('apps').updateOne({ _id: packageId }, { $set: { latestVersionCode: top.length ? top[0].versionCode : 0 } });
    res.json({ ok: true, deleted: r.deletedCount });
  })
);

/** Remove an app and all of its versions from the catalog. Licenses and purchase history are kept. */
adminRoutes.delete(
  '/admin/apps/:packageId',
  wrap(async (req, res) => {
    const packageId = needPackage(req.params.packageId);
    const v = await col('versions').deleteMany({ packageId });
    const a = await col('apps').deleteOne({ _id: packageId });
    res.json({ ok: true, apps: a.deletedCount, versions: v.deletedCount });
  })
);

/** Empty the whole catalog (apps and versions). Needs {"confirm":"DELETE ALL"}. GitHub releases are untouched. */
adminRoutes.post(
  '/admin/reset-catalog',
  wrap(async (req, res) => {
    if (req.body?.confirm !== 'DELETE ALL') {
      throw new AppError(400, 'confirm_required', 'Send {"confirm":"DELETE ALL"}');
    }
    const v = await col('versions').deleteMany({});
    const a = await col('apps').deleteMany({});
    res.json({ ok: true, apps: a.deletedCount, versions: v.deletedCount });
  })
);

/** Show or hide an app in the Featured row on Home. */
adminRoutes.post(
  '/admin/featured',
  wrap(async (req, res) => {
    const packageId = needPackage(req.body?.packageId);
    const r = await col('apps').updateOne({ _id: packageId }, { $set: { featured: req.body?.featured === true } });
    if (r.matchedCount !== 1) throw new AppError(404, 'app_not_found');
    res.json({ ok: true });
  })
);
