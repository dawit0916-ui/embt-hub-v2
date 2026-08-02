const bot = require('./bot');
const taskState = require('./config');
const { CONFIG_CHANNEL_ID } = require('../config/constants');

// Parses one pinned message into multiple tasks, separated by a line
// containing just "---". Each block looks like:
//
//   TASK: comment
//   WORD: CRYPTO2026
//   ---
//   TASK: reaction
//   EMOJI: 🔥
//   MESSAGE_ID: 4821
//
// taskKey is derived from the task's own content (not the date), so the
// same task keeps the same identity across polls — that's what lets
// CompletedTask correctly track "already done" per task per day.
function parsePinnedTasks(text) {
    const blocks = text.split(/^-{3,}$/m);
    const tasks = [];

    for (const block of blocks) {
        const taskMatch = block.match(/TASK:\s*(comment|reaction)/i);
        if (!taskMatch) continue;
        const type = taskMatch[1].toLowerCase();

        if (type === 'comment') {
            const wordMatch = block.match(/WORD:\s*(\S+)/i);
            const word = wordMatch ? wordMatch[1].toUpperCase() : null;
            if (!word) continue;
            tasks.push({
                taskKey: `comment_${word}`,
                type: 'comment',
                word,
                emoji: null,
                messageId: null
            });
        } else {
            const emojiMatch = block.match(/EMOJI:\s*(\S+)/iu);
            const msgMatch = block.match(/MESSAGE_ID:\s*(\d+)/i);
            const messageId = msgMatch ? parseInt(msgMatch[1]) : null;
            const emoji = emojiMatch ? emojiMatch[1] : null;
            if (!messageId || !emoji) continue;
            tasks.push({
                taskKey: `reaction_${messageId}`,
                type: 'reaction',
                word: null,
                emoji,
                messageId
            });
        }
    }

    return tasks;
}

async function updateDailyConfig(attempt = 1) {
    try {
        const chat = await bot.telegram.getChat(CONFIG_CHANNEL_ID);
        const text = chat.pinned_message?.text || '';

        const tasks = parsePinnedTasks(text);
        if (tasks.length === 0) {
            console.warn('No valid TASK blocks found in pinned message');
            return;
        }

        taskState.tasks = tasks;
        console.log(`✅ Loaded ${tasks.length} task(s) for today:`, tasks.map(t => t.taskKey));

    } catch (err) {
        console.error(`Error reading CMS config (attempt ${attempt}):`, err.message);

        if (attempt < 3) {
            const delay = attempt * 3000; // 3s, then 6s
            setTimeout(() => updateDailyConfig(attempt + 1), delay);
        } else {
            console.error('⚠️ CMS config fetch failed after 3 attempts — keeping previous task pool until next scheduled poll.');
        }
    }
}

setInterval(() => updateDailyConfig(), 30 * 60 * 1000);
updateDailyConfig();

module.exports = { updateDailyConfig, parsePinnedTasks };
