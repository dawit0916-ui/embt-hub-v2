import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { cfg } from '../config.js';
import { col } from '../db.js';
import { findUser } from '../economy.js';
import { signSession } from '../auth.js';
import { AppError, hmac, needString, wrap } from '../util.js';

export const authRoutes = Router();

const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

/**
 * The app sends the code the user got from the bot's /linkstore command, plus a device id
 * (hashed again here). A code can be used once.
 */
authRoutes.post(
  '/auth/link',
  linkLimiter,
  wrap(async (req, res) => {
    const code = needString(req.body?.code, 'code', 32).trim().toUpperCase();
    const deviceId = needString(req.body?.deviceId, 'deviceId', 200);
    const deviceHash = hmac(cfg.hmacSecret, 'device:' + deviceId);

    const rec = await col('linkCodes').findOneAndUpdate(
      { codeHash: hmac(cfg.hmacSecret, code), used: false, expiresAt: { $gt: new Date() } },
      { $set: { used: true, usedAt: new Date() } }
    );
    if (!rec) throw new AppError(400, 'bad_code', 'Code is wrong or expired');

    const user = await findUser(rec.userId);
    if (!user) throw new AppError(404, 'no_such_user');
    if (user.is_banned) throw new AppError(403, 'banned', 'Account banned');

    const known = await col('devices').findOne({ userId: rec.userId, hash: deviceHash });
    if (!known) {
      const count = await col('devices').countDocuments({ userId: rec.userId });
      if (count >= cfg.maxDevices) {
        throw new AppError(409, 'device_limit', `This account already has ${cfg.maxDevices} devices linked`);
      }
      await col('devices').insertOne({ userId: rec.userId, hash: deviceHash, addedAt: new Date() });
    }
    res.json({ token: signSession(rec.userId, deviceHash) });
  })
);
