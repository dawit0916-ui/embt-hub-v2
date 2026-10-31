import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { cfg } from '../config.js';
import { ObjectId, col, getClient } from '../db.js';
import { requireAuth } from '../auth.js';
import { balanceOf, debit, writeLedger } from '../economy.js';
import { purchaseMessage, sendBotMessage } from '../notify.js';
import { AppError, hmac, needPackage, needString, numericCode, safeEqual, wrap } from '../util.js';

export const purchaseRoutes = Router();

const MAX_ATTEMPTS = 5;
const startLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
});

purchaseRoutes.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const licenses = await col('licenses')
      .find({ userId: req.user.id, status: { $in: ['active', 'disputed'] } })
      .project({ packageId: 1, status: 1, _id: 0 })
      .toArray();
    res.json({
      userId: req.user.id,
      balance: balanceOf(req.user.doc),
      devices: await col('devices').countDocuments({ userId: req.user.id }),
      licenses,
    });
  })
);

/** Step 1: create a pending purchase and have the bot send the confirmation code. */
purchaseRoutes.post(
  '/purchases/start',
  requireAuth,
  startLimiter,
  wrap(async (req, res) => {
    const packageId = needPackage(req.body?.packageId);
    const userId = req.user.id;
    const app = await col('apps').findOne({ _id: packageId, hidden: { $ne: true } });
    if (!app) throw new AppError(404, 'not_found');
    if (app.access !== 'paid' || !(app.price > 0)) throw new AppError(400, 'not_for_sale');

    const lic = await col('licenses').findOne({ userId, packageId, status: { $in: ['active', 'disputed'] } });
    if (lic) throw new AppError(409, 'already_owned');
    if (balanceOf(req.user.doc) < app.price) throw new AppError(402, 'insufficient_balance');

    await col('purchases').updateMany(
      { userId, packageId, status: 'pending' },
      { $set: { status: 'expired' } }
    );
    const code = numericCode(6);
    const ins = await col('purchases').insertOne({
      userId,
      packageId,
      price: app.price,
      codeHash: hmac(cfg.hmacSecret, `purchase:${userId}:${code}`),
      attempts: 0,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    try {
      await sendBotMessage(userId, purchaseMessage(app.name, app.price, code, cfg.currency));
    } catch (e) {
      await col('purchases').updateOne({ _id: ins.insertedId }, { $set: { status: 'expired' } });
      throw e;
    }
    res.json({ purchaseId: String(ins.insertedId), price: app.price, expiresInSec: 300 });
  })
);

/** Step 2: verify the code, then charge and grant the license in ONE transaction. */
purchaseRoutes.post(
  '/purchases/confirm',
  requireAuth,
  wrap(async (req, res) => {
    const userId = req.user.id;
    const idStr = needString(req.body?.purchaseId, 'purchaseId', 40);
    if (!ObjectId.isValid(idStr)) throw new AppError(400, 'bad_purchase');
    const code = needString(req.body?.code, 'code', 12).trim();
    const _id = new ObjectId(idStr);

    // Count the attempt first, atomically, so parallel guesses cannot exceed the limit.
    const p = await col('purchases').findOneAndUpdate(
      { _id, userId, status: 'pending', expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' }
    );
    if (!p) throw new AppError(400, 'purchase_unavailable', 'Purchase expired, completed or locked');
    if (!safeEqual(p.codeHash, hmac(cfg.hmacSecret, `purchase:${userId}:${code}`))) {
      throw new AppError(400, 'wrong_code', `Wrong code. ${MAX_ATTEMPTS - p.attempts} tries left`);
    }

    const app = await col('apps').findOne({ _id: p.packageId });
    // Price is read on the server now. If it changed since the code was sent, start over.
    if (!app || app.access !== 'paid' || app.price !== p.price) {
      throw new AppError(409, 'price_changed', 'Price changed. Start the purchase again');
    }

    const session = getClient().startSession();
    try {
      await session.withTransaction(async () => {
        const fresh = await col('purchases').findOneAndUpdate(
          { _id, status: 'pending' },
          { $set: { status: 'completed', completedAt: new Date() } },
          { session }
        );
        if (!fresh) throw new AppError(409, 'purchase_unavailable');

        const existing = await col('licenses').findOne({ userId, packageId: p.packageId }, { session });
        if (existing && existing.status !== 'revoked') throw new AppError(409, 'already_owned');

        if (!(await debit(userId, p.price, `Store purchase: ${app.name}`, `store_${p.packageId}`, session))) {
          throw new AppError(402, 'insufficient_balance');
        }

        await col('licenses').updateOne(
          { userId, packageId: p.packageId },
          { $set: { status: 'active', purchaseId: _id, createdAt: new Date() } },
          { upsert: true, session }
        );
        await writeLedger(
          { userId, delta: -p.price, reason: 'purchase', packageId: p.packageId, purchaseId: _id },
          session
        );
      });
    } finally {
      await session.endSession();
    }
    res.json({ ok: true, packageId: p.packageId });
  })
);
