import { AppError, escapeHtml } from './util.js';

let sender = null;
/** The bot passes in a function (chatId, html) => Promise that sends a private message. */
export const setSender = (fn) => {
  sender = fn;
};

export async function sendBotMessage(chatId, html) {
  if (!sender) throw new AppError(503, 'bot_not_configured', 'Bot is not available');
  try {
    await sender(chatId, html);
  } catch (e) {
    console.error('[store] could not message user:', e?.message);
    throw new AppError(502, 'bot_send_failed', 'Could not message you. Open the bot, press Start, then try again');
  }
}

export const purchaseMessage = (appName, price, code, currency) =>
  `Confirm purchase of <b>${escapeHtml(appName)}</b> for ${price} ${escapeHtml(currency)}?\n` +
  `Code: <code>${code}</code>\nExpires in 5 minutes. If this was not you, ignore this message.`;
