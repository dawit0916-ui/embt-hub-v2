import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { configure } from './config.js';
import { ensureIndexes } from './db.js';
import { setSender } from './notify.js';
import { createLinkCode } from './linkCodes.js';
import { AppError } from './util.js';
import { authRoutes } from './routes/auth.js';
import { appsRoutes } from './routes/apps.js';
import { downloadRoutes } from './routes/download.js';
import { deliveriesRoutes } from './routes/deliveries.js';
import { purchaseRoutes } from './routes/purchases.js';
import { refundRoutes } from './routes/refunds.js';
import { scanRoutes } from './routes/scan.js';
import { configRoutes } from './routes/config.js';
import { adminRoutes } from './routes/admin.js';

/**
 * Builds the store as an Express router you mount into the bot's app:
 *   app.use('/store', store.router)
 * sendMessage(chatId, html) must send a private Telegram message (HTML parse mode).
 * The body parser is the bot's own global express.json(), so none is added here.
 */
export function createStore({ sendMessage, env = process.env }) {
  configure(env);
  setSender(sendMessage);

  const router = express.Router();
  router.use(helmet());
  router.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  router.get('/health', (_req, res) => res.json({ ok: true }));
  for (const r of [
    authRoutes,
    configRoutes,
    appsRoutes,
    downloadRoutes,
    deliveriesRoutes,
    purchaseRoutes,
    refundRoutes,
    scanRoutes,
    adminRoutes,
  ]) {
    router.use(r);
  }

  router.use((_req, _res, next) => next(new AppError(404, 'not_found')));

  // Errors are answered here so a store failure can never crash the bot.
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error('[store]', err);
    res.status(500).json({ error: 'server_error' });
  });

  return { router, init: ensureIndexes, createLinkCode };
}
