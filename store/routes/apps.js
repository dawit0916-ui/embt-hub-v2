import { Router } from 'express';
import { col } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError, needPackage, wrap } from '../util.js';

export const appsRoutes = Router();

/** Light list for the home screen: icon, id, name only (plus access and ownership). */
appsRoutes.get(
  '/apps',
  requireAuth,
  wrap(async (req, res) => {
    const list = await col('apps')
      .find({ hidden: { $ne: true } })
      .project({ name: 1, iconUrl: 1, latestVersionCode: 1, access: 1, price: 1 })
      .sort({ name: 1 })
      .limit(500)
      .toArray();
    const lic = await col('licenses')
      .find({ userId: req.user.id, status: { $in: ['active', 'disputed'] } })
      .project({ packageId: 1, status: 1 })
      .toArray();
    const owned = new Map(lic.map((l) => [l.packageId, l.status]));
    res.json({
      apps: list.map((a) => ({
        packageId: a._id,
        name: a.name,
        iconUrl: a.iconUrl,
        latestVersionCode: a.latestVersionCode ?? 0,
        access: a.access,
        price: a.price ?? 0,
        license: owned.get(a._id) ?? null,
      })),
    });
  })
);

/** Loaded only when an app is tapped: screenshots, details, versions and file metadata (no asset ids). */
appsRoutes.get(
  '/apps/:packageId',
  requireAuth,
  wrap(async (req, res) => {
    const packageId = needPackage(req.params.packageId);
    const app = await col('apps').findOne({ _id: packageId, hidden: { $ne: true } });
    if (!app) throw new AppError(404, 'not_found');
    const versions = await col('versions')
      .find({ packageId })
      .sort({ versionCode: -1 })
      .limit(10)
      .toArray();
    res.json({
      packageId: app._id,
      name: app.name,
      iconUrl: app.iconUrl,
      screenshots: app.screenshots ?? [],
      description: app.description ?? '',
      category: app.category ?? '',
      access: app.access,
      price: app.price ?? 0,
      versions: versions.map((v) => ({
        versionCode: v.versionCode,
        versionName: v.versionName,
        changelog: v.changelog ?? '',
        files: v.files.map((f) => ({
          key: f.key,
          role: f.role,
          splitName: f.splitName ?? '',
          configFor: f.configFor ?? '',
          requires: f.requires ?? [],
          sha256: f.sha256,
          size: f.size,
        })),
      })),
    });
  })
);
