const { User, ReferralEarning } = require('../models');
const bot = require('../bot/bot');
const { getSettings } = require('./settings');

/**
 * Call right AFTER crediting `reward` to `userId`.
 * - Pays the referrer a commission on the reward
 * - If countsAsTask: bumps the friend's task counter and pays the one-time
 *   invite bonus when the required task count is reached
 * Never throws — a referral failure must not break the user's own claim.
 */
async function payReferral(userId, reward, { countsAsTask = false } = {}) {
    try {
        if (!(reward > 0)) return;

        const fields = 'referred_by referral_paid referral_tasks_done';
        const friend = countsAsTask
            ? await User.findOneAndUpdate({ user_id: userId }, { $inc: { referral_tasks_done: 1 } }, { new: true }).select(fields)
            : await User.findOne({ user_id: userId }).select(fields);
        if (!friend || !friend.referred_by) return;

        const settings = await getSettings();
        if (!settings) return;

        // 1. Commission on this earning
        const commission = reward * ((settings.ref_commission_percent ?? 10) / 100);
        if (commission > 0) {
            await User.updateOne({ user_id: friend.referred_by }, { $inc: { balance: commission } });
            await ReferralEarning.updateOne(
                { referrerId: friend.referred_by, friendId: userId },
                { $inc: { totalEarned: commission }, $set: { lastEarnedAt: new Date() } },
                { upsert: true }
            );
        }

        // 2. One-time invite bonus after N completed tasks
        if (countsAsTask && !friend.referral_paid) {
            const required = settings.ref_tasks_required || 3;
            if (friend.referral_tasks_done >= required) {
                const flipped = await User.updateOne(
                    { user_id: userId, referral_paid: { $ne: true } },
                    { $set: { referral_paid: true } }
                );
                if (flipped.modifiedCount > 0) {
                    const bonus = settings.ref_bonus_amount || 0;
                    if (bonus > 0) {
                        await User.updateOne({ user_id: friend.referred_by }, { $inc: { balance: bonus } });
                    }
                    try {
                        await bot.telegram.sendMessage(
                            friend.referred_by,
                            `🎊 *Invite Bonus:* Your friend completed ${required} tasks! You earned ${bonus} DASH.\nYou now earn ${settings.ref_commission_percent ?? 10}% of everything this friend earns.`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (botErr) {
                        console.error('Referral notify error:', botErr.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error('payReferral error:', err);
    }
}

module.exports = { payReferral };
