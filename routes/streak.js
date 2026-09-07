const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const { User } = require('../models');

const DAILY_REWARDS = [50, 75, 100, 150, 200, 300, 500]; // index 0 = day 1

function utcDayDiff(a, b) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    return Math.round((utcA - utcB) / msPerDay);
}

router.get('/api/secure/streak/status', validateInitData, async (req, res) => {
    try {
        const userId = Number(req.tgUser.id);
        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const now = new Date();
        const claimedToday = user.lastClaimDate ? utcDayDiff(now, user.lastClaimDate) === 0 : false;

        // if they missed a day entirely, the streak will reset on next claim — reflect that here too
        const missedStreak = user.lastClaimDate && utcDayDiff(now, user.lastClaimDate) > 1;
        const displayDay = missedStreak ? 1 : user.streakDay;

        return res.json({
            success: true,
            streakDay: displayDay,
            claimedToday,
            currentStreak: missedStreak ? 0 : user.currentStreak,
            longestStreak: user.longestStreak,
            rewards: DAILY_REWARDS
        });
    } catch (err) {
        console.error('Streak status error:', err);
        return res.status(500).json({ error: 'Failed to load streak status' });
    }
});

router.post('/api/secure/streak/claim', validateInitData, async (req, res) => {
    try {
        const userId = Number(req.tgUser.id);
        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const now = new Date();

        if (user.lastClaimDate) {
            const diff = utcDayDiff(now, user.lastClaimDate);
            if (diff === 0) {
                return res.status(400).json({ error: 'Already claimed today' });
            }
        }

        const diff = user.lastClaimDate ? utcDayDiff(now, user.lastClaimDate) : null;
        const missedStreak = diff !== null && diff > 1;

        const dayToClaim = missedStreak ? 1 : user.streakDay;
        const reward = DAILY_REWARDS[dayToClaim - 1];
        const nextStreakDay = dayToClaim === 7 ? 1 : dayToClaim + 1;
        const newCurrentStreak = missedStreak ? 1 : (user.currentStreak || 0) + 1;
        const newLongestStreak = Math.max(user.longestStreak || 0, newCurrentStreak);

        user.balance = (user.balance || 0) + reward;
        user.total_earned = (user.total_earned || 0) + reward;
        user.streakDay = nextStreakDay;
        user.lastClaimDate = now;
        user.currentStreak = newCurrentStreak;
        user.longestStreak = newLongestStreak;
        await user.save();

        return res.json({
            success: true,
            claimedDay: dayToClaim,
            reward,
            newBalance: user.balance,
            nextStreakDay,
            currentStreak: newCurrentStreak
        });
    } catch (err) {
        console.error('Streak claim error:', err);
        return res.status(500).json({ error: 'Failed to claim streak reward' });
    }
});

module.exports = router;
