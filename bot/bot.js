const https = require('https');
const { Telegraf, Telegram } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent: new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, family: 4 }),
    webhookReply: false, // normal API calls, so ctx.reply returns the real message
  },
});

// Retry only when the request never reached Telegram, or for read-only calls.
const NEVER_SENT = new Set(['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH']);
const READ_ONLY = new Set(['getMe', 'getChatMember', 'getChat', 'getFile', 'getWebhookInfo']);
const TRIES = 3;
const CALL_TIMEOUT_MS = 20000;

// Patch the class, because Telegraf makes a new Telegram instance per update
const origCallApi = Telegram.prototype.callApi;

Telegram.prototype.callApi = async function (method, data, ...rest) {
  if (method === 'getUpdates') return origCallApi.call(this, method, data, ...rest);

  let lastErr;
  for (let i = 1; i <= TRIES; i++) {
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('Telegram call timed out'), { code: 'TG_TIMEOUT', type: 'system' })),
          CALL_TIMEOUT_MS
        );
      });
      return await Promise.race([origCallApi.call(this, method, data, ...rest), timeout]);
    } catch (err) {
      lastErr = err;
      const code = err.code || err.errno;
      const network = err.type === 'system' || NEVER_SENT.has(code);
      const retryable = NEVER_SENT.has(code) || (READ_ONLY.has(method) && network);
      if (!retryable || i === TRIES) throw err;
      console.warn(`[tg retry] ${method} attempt ${i}/${TRIES} failed: ${code || err.message}`);
      await new Promise((r) => setTimeout(r, 700 * i));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
};

module.exports = bot;
