const { User, ReferralEarning } = require('../models');
const bot = require('../bot/bot');
const { getSettings } = require('./settings');
const { recordEarning, recordInvite } = require('./weekly');

// Flips a friend to Active and pays the one-time invite bonus. Safe to call repeatedly.
async function awardMilestone(friendId, referrerId, settings) {
    const required = settings.ref_tasks_required || 3;
    const flipped = await User.updateOne(
        { user_id: friendId, referral_paid: { $ne: true }, referral_tasks_done: { $gte: required } },
        { $set: { referral_paid: true } }
    );
    if (flipped.modifiedCount === 0) return false;
    await recordInvite(referrerId);

    const bonus = settings.ref_bonus_amount || 0;
    if (bonus > 0) {
        await User.updateOne({ user_id: referrerId }, { $inc: { balance: bonus } });
    }
    try {
        await bot.telegram.sendMessage(
            referrerId,
            `🎊 *Invite Bonus:* Your friend completed ${required} tasks! You earned ${bonus} DASH.\nYou now earn ${settings.ref_commission_percent ?? 10}% of everything this friend earns.`,
            { parse_mode: 'Markdown' }
        );
    } catch (botErr) {
        console.error('Referral notify error:', botErr.message);
    }
    return true;
}

/**
 * Call right AFTER crediting `reward` to `userId`.
 * - Pays the referrer a commission on the reward
 * - If countsAsTask: bumps the friend's task counter
 * - On ANY earning, activates the friend once they have enough tasks
 * Never throws: a referral failure must not break the user's own claim.
 */
async function payReferral(userId, reward, { countsAsTask = false } = {}) {
    try {
        if (!(reward > 0)) return;
        await recordEarning(userId, reward);

        const fields = 'referred_by referral_paid referral_tasks_done';
        const friend = countsAsTask
            ? await User.findOneAndUpdate({ user_id: userId }, { $inc: { referral_tasks_done: 1 } }, { new: true }).select(fields)
            : await User.findOne({ user_id: userId }).select(fields);
        if (!friend || !friend.referred_by) return;

        const settings = await getSettings();
        if (!settings) return;

        // 1. Commission only once the friend is already activated (no hold, no back-pay)
        if (friend.referral_paid) {
            const commission = reward * ((settings.ref_commission_percent ?? 10) / 100);
            if (commission > 0) {
                await User.updateOne({ user_id: friend.referred_by }, { $inc: { balance: commission } });
                await ReferralEarning.updateOne(
                    { referrerId: friend.referred_by, friendId: userId },
                    { $inc: { totalEarned: commission }, $set: { lastEarnedAt: new Date() } },
                    { upsert: true }
                );
            }
        }

        // 2. Activate when enough tasks are done (runs on any earning, so it self-heals)
        if (!friend.referral_paid && friend.referral_tasks_done >= (settings.ref_tasks_required || 5)) {
            await awardMilestone(userId, friend.referred_by, settings);
        }
    } catch (err) {
        console.error('payReferral error:', err);
    }
}

module.exports = { payReferral };
