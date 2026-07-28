const bot = require('./bot');
const taskState = require('./config');
const { CONFIG_CHANNEL_ID } = require('../config/constants');

async function updateDailyConfig(attempt = 1) {
    try {
        const chat = await bot.telegram.getChat(CONFIG_CHANNEL_ID);
        const text = chat.pinned_message?.text || '';

        const taskMatch = text.match(/TASK:\s*(comment|reaction)/i);
        if (!taskMatch) return console.warn('No TASK: line found in pinned message');

        const type = taskMatch[1].toLowerCase();

        if (type === 'comment') {
            const wordMatch = text.match(/WORD:\s*(\S+)/i);
            taskState.activeTask = {
                type: 'comment',
                word: wordMatch ? wordMatch[1].toUpperCase() : null,
                emoji: null,
                messageId: null
            };
        } else {
            const emojiMatch = text.match(/EMOJI:\s*(\S+)/iu);
            const msgMatch = text.match(/MESSAGE_ID:\s*(\d+)/i);
            taskState.activeTask = {
                type: 'reaction',
                word: null,
                emoji: emojiMatch ? emojiMatch[1] : null,
                messageId: msgMatch ? parseInt(msgMatch[1]) : null
            };
        }

        console.log('✅ Active task today:', taskState.activeTask);

    } catch (err) {
        console.error(`Error reading CMS config (attempt ${attempt}):`, err.message);

        if (attempt < 3) {
            const delay = attempt * 3000; // 3s, then 6s
            setTimeout(() => updateDailyConfig(attempt + 1), delay);
        } else {
            console.error('⚠️ CMS config fetch failed after 3 attempts — keeping previous activeTask until next scheduled poll.');
        }
    }
}

setInterval(() => updateDailyConfig(), 10 * 60 * 1000);
updateDailyConfig();

module.exports = { updateDailyConfig };
