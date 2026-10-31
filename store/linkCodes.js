import { cfg } from './config.js';
import { col } from './db.js';
import { findUser, toUserId } from './economy.js';
import { AppError, hmac, linkCode } from './util.js';

/** Called by the bot's /linkstore command. Returns a one-time code valid for 5 minutes. */
export async function createLinkCode(telegramId) {
  const userId = toUserId(telegramId);
  const user = await findUser(userId);
  if (!user) throw new AppError(404, 'no_such_user', 'Start the bot first');
  if (user.is_banned) throw new AppError(403, 'banned', 'Account banned');
  await col('linkCodes').deleteMany({ userId, used: false });
  const code = linkCode();
  await col('linkCodes').insertOne({
    userId,
    codeHash: hmac(cfg.hmacSecret, code),
    used: false,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return { code, expiresInSec: 300 };
}
