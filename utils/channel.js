const bot = require('../bot/bot');
const { STORAGE_CHANNEL_ID } = require('../config/constants');

async function postToChannel(text, extra = {}) {
    if (!STORAGE_CHANNEL_ID) return null;
    try {
        const msg = await bot.telegram.sendMessage(STORAGE_CHANNEL_ID, text, { parse_mode: 'Markdown', ...extra });
        return msg.message_id;
    } catch (e) {
        console.error('[Channel Log Failed, retrying plain]:', e.message);
        try {
            const msg = await bot.telegram.sendMessage(STORAGE_CHANNEL_ID, text, { ...extra });
            return msg.message_id;
        } catch (e2) {
            console.error('[Channel Log Failed]:', e2.message);
            return null;
        }
    }
}

async function postPhotoToChannel(buffer, caption) {
    if (!STORAGE_CHANNEL_ID) return { messageId: null, fileId: null };
    const pick = (msg) => ({ messageId: msg.message_id, fileId: msg.photo[msg.photo.length - 1].file_id });
    try {
        return pick(await bot.telegram.sendPhoto(STORAGE_CHANNEL_ID, { source: buffer }, { caption, parse_mode: 'Markdown' }));
    } catch (e) {
        console.error('[Channel Photo Failed, retrying plain]:', e.message);
        try {
            return pick(await bot.telegram.sendPhoto(STORAGE_CHANNEL_ID, { source: buffer }, { caption }));
        } catch (e2) {
            console.error('[Channel Photo Failed]:', e2.message);
            return { messageId: null, fileId: null };
        }
    }
}

async function replyInChannel(replyToMessageId, text) {
    try {
        if (!STORAGE_CHANNEL_ID || !replyToMessageId) return null;
        const msg = await bot.telegram.sendMessage(STORAGE_CHANNEL_ID, text, {
            parse_mode: 'Markdown',
            reply_to_message_id: replyToMessageId
        });
        return msg.message_id;
    } catch (e) {
        console.error('[Channel Reply Failed]:', e.message);
        return null;
    }
}

module.exports = { postToChannel, postPhotoToChannel, replyInChannel };
