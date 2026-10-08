const mongoose = require('mongoose');
const bot = require('../bot/bot');
const { User, WeeklyStat, WeeklyPayout } = require('../models');
const { getSettings } = require('./settings');
const { getWeekKey, getWeekStart } = require('./weekly');

const TOP_N = 5;

const CATEGORIES = {
    earners:  { field: 'earned',  label: 'earner',  prizesKey: 'weekly_earner_prizes',  minKey: 'weekly_min_earned'  },
    inviters: { field: 'invites', label: 'inviter', prizesKey: 'weekly_inviter_prizes', minKey: 'weekly_min_invites' }
};

async function buildWinners(weekKey, cfg, settings) {
    const prizes = Array.from(settings[cfg.prizesKey] || []).slice(0, TOP_N).map(p => Number(p) || 0);
    const minScore = Number(settings[cfg.minKey]) || 0;

    const rows = await WeeklyStat.aggregate([
        { $match: { week_key: weekKey, [cfg.field]: { $gt: 0, $gte: minScore } } },
        { $sort: { [cfg.field]: -1, _id: 1 } },
        { $limit: 25 },
        { $lookup: { from: 'users', localField: 'user_id', foreignField: 'user_id', as: 'u' } },
        { $unwind: '$u' },
        { $match: { 'u.is_banned': { $ne: true } } },
        { $limit: TOP_N },
        { $project: { _id: 0, user_id: 1, score: `$${cfg.field}` } }
    ]);

    return rows
        .map((r, i) => ({ rank: i + 1, user_id: r.user_id, score: r.score, prize: prizes[i] || 0, paid: false }))
        .filter(w => w.prize > 0);
}

async function payCategory(weekKey, category, settings) {
    const cfg = CATEGORIES[category];

    let doc = await WeeklyPayout.findOne({ week_key: weekKey, category });
    if (!doc) {
        // If rewards were off when the week ended, record an empty payout so
        // switching them on later never pays an old week retroactively.
        const winners = settings.weekly_rewards_enabled ? await buildWinners(weekKey, cfg, settings) : [];
        try {
            doc = await WeeklyPayout.create({ week_key: weekKey, category, winners });
        } catch (e) {
            if (e.code === 11000) return; // already created by another run
            throw e;
        }
    }

    for (const w of doc.winners) {
        if (w.paid) continue;

        // Claim the slot first so a winner can never be paid twice
        const claim = await WeeklyPayout.updateOne(
            { week_key: weekKey, category, winners: { $elemMatch: { user_id: w.user_id, paid: false } } },
            { $set: { 'winners.$.paid': true } }
        );
        if (claim.modifiedCount === 0) continue;

        try {
            await User.updateOne(
                { user_id: w.user_id },
                {
                    $inc: { balance: w.prize, total_earned: w.prize },
                    $push: {
                        history: {
                            title: `Weekly Top ${cfg.label} reward (#${w.rank})`,
                            reward: w.prize,
                            taskId: `weekly_${category}_${weekKey}`,
                            date: new Date()
                        }
                    }
                }
            );
        } catch (err) {
            console.error('Weekly payout credit failed, releasing slot:', err.message);
            await WeeklyPayout.updateOne(
                { week_key: weekKey, category, winners: { $elemMatch: { user_id: w.user_id, paid: true } } },
                { $set: { 'winners.$.paid': false } }
            );
            continue;
        }

        try {
            await bot.telegram.sendMessage(
                w.user_id,
                `🏆 Weekly reward! You finished #${w.rank} among last week's top ${cfg.label}s and earned ${w.prize} DASH.`
            );
        } catch (e) {
            console.error('Weekly notify error:', e.message);
        }
    }
}

async function runWeeklyPayoutCheck() {
    try {
        if (mongoose.connection.readyState !== 1) return;
        const settings = await getSettings();
        if (!settings) return;

        // The week that just ended
        const prevKey = getWeekKey(new Date(getWeekStart().getTime() - 1));

        await payCategory(prevKey, 'earners', settings);
        await payCategory(prevKey, 'inviters', settings);
    } catch (err) {
        console.error('Weekly payout check error:', err);
    }
}

function startWeeklyPayoutWorker() {
    setTimeout(runWeeklyPayoutCheck, 30 * 1000);
    setInterval(runWeeklyPayoutCheck, 5 * 60 * 1000);
}

module.exports = { startWeeklyPayoutWorker, runWeeklyPayoutCheck };
