const { WeeklyStat } = require('../models');

// Week = Monday 00:00 UTC -> next Monday 00:00 UTC
function getWeekStart(date = new Date()) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    const sinceMonday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - sinceMonday);
    return d;
}

function getNextWeekStart(date = new Date()) {
    const d = getWeekStart(date);
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
}

function getWeekKey(date = new Date()) {
    return getWeekStart(date).toISOString().slice(0, 10);
}

async function bump(userId, field, amount, retry = true) {
    try {
        if (!userId || !(amount > 0)) return;
        await WeeklyStat.updateOne(
            { week_key: getWeekKey(), user_id: Number(userId) },
            { $inc: { [field]: amount } },
            { upsert: true }
        );
    } catch (err) {
        // Two simultaneous first-writes can collide on the unique index: retry once
        if (err.code === 11000 && retry) return bump(userId, field, amount, false);
        console.error(`weekly ${field} error:`, err.message);
    }
}

const recordEarning = (userId, amount) => bump(userId, 'earned', amount);
const recordInvite = (userId) => bump(userId, 'invites', 1);

module.exports = { getWeekStart, getNextWeekStart, getWeekKey, recordEarning, recordInvite };
