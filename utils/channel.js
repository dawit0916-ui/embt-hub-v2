const bot = require('../bot/bot');
const { STORAGE_CHANNEL_ID } = require('../config/constants');

async function postToChannel(text, extra = {}) {
    try {
        if (!STORAGE_CHANNEL_ID) return null;
        const msg = await bot.telegram.sendMessage(STORAGE_CHANNEL_ID, text, {
            parse_mode: 'Markdown',
            ...extra
        });
        return msg.message_id;
    } catch (e) {
        console.error('[Channel Log Failed]:', e.message);
        return null;
    }
}

async function postPhotoToChannel(buffer, caption) {
    try {
        if (!STORAGE_CHANNEL_ID) return { messageId: null, fileId: null };
        const msg = await bot.telegram.sendPhoto(
            STORAGE_CHANNEL_ID,
            { source: buffer },
            { caption, parse_mode: 'Markdown' }
        );
        return {
            messageId: msg.message_id,
            fileId: msg.photo[msg.photo.length - 1].file_id
        };
    } catch (e) {
        console.error('[Channel Photo Failed]:', e.message);
        return { messageId: null, fileId: null };
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
