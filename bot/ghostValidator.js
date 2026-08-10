const bot = require('./bot');
const { User, Task } = require('../models');
const { getSettings } = require('../utils/settings');

// --- GHOST VALIDATOR ENGINE ---
async function runGhostValidator(ctx) {
    try {
        if (ctx) await ctx.reply("🕵️ *Ghost Validator:* Starting the Midnight Sweep...");

        const users = await User.find({ red_flag: false });
        const tgTasks = await Task.find({ type: 'telegram' });
        const settings = await getSettings();
        let caughtCount = 0;

        for (const user of users) {
            for (const taskId of user.completed_tasks) {
                const task = tgTasks.find(t => t.id === taskId);
                if (!task) continue;

                const channelId = "@" + task.url.split('t.me/')[1].split('/')[0];

                try {
                    const member = await bot.telegram.getChatMember(channelId, user.user_id);
                    if (['left', 'kicked'].includes(member.status)) {
                        caughtCount++;
                        await User.updateOne(
                            { user_id: user.user_id },
                            {
                                $set: { red_flag: true },
                                $inc: { balance: -settings.penalty_fee },
                                $pull: { completed_tasks: taskId },
                                $addToSet: { penalized_tasks: taskId }
                            }
                        );

                        await bot.telegram.sendMessage(user.user_id, `🚩 *Account Flagged!* You left a channel. A ${settings.penalty_fee} DASH penalty applied.`);
                        break;
                    }
                } catch (e) {
                    continue;
                }
                await new Promise(res => setTimeout(res, 100));
            }
        }
        if (ctx) await ctx.reply(`✨ *Sweep Complete!* Found and penalized ${caughtCount} cheaters.`);
        return { success: true, caughtCount };
    } catch (globalError) {
        console.error("Ghost Validator Global Error:", globalError);
        if (ctx) await ctx.reply("❌ The validator encountered a critical error during the sweep.");
        return { success: false, caughtCount: 0 };
    }
}

// 🤖 Automated Background Validation (Keep your existing one)
setInterval(async () => {
    try {
        console.log("🤖 System automated task audit pass sequence active...");
        await runGhostValidator(null);
    } catch (err) { console.error("Worker lifecycle failure:", err); }
}, 24 * 60 * 60 * 1000);

module.exports = { runGhostValidator };
