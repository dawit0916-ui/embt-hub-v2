import jwt from 'jsonwebtoken';
import { cfg } from './config.js';
import { col } from './db.js';
import { findUser, toUserId } from './economy.js';
import { AppError, wrap } from './util.js';

/** Verifies the session token, that the user exists and is not banned, and that the device is still linked. */
export const requireAuth = wrap(async (req, _res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  let claims;
  try {
    claims = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new AppError(401, 'unauthorized');
  }
  const userId = toUserId(claims.sub);
  const user = await findUser(userId);
  if (!user) throw new AppError(401, 'unauthorized');
  if (user.is_banned) throw new AppError(403, 'banned', 'Account banned');
  const dev = await col('devices').findOne({ userId, hash: claims.dev }, { projection: { _id: 1 } });
  if (!dev) throw new AppError(401, 'device_not_linked');
  req.user = { id: userId, doc: user, deviceHash: claims.dev };
  next();
});

export const signSession = (userId, deviceHash) =>
  jwt.sign({ sub: String(userId), dev: deviceHash }, cfg.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '30d',
  });
