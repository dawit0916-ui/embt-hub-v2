const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const { User } = require('../models');

// Invites are counted live from referred_by so they always match the Friends tab
async function inviteLeaderboard(userId) {
    const top = await User.aggregate([
        { $match: { referred_by: { $ne: null }, referral_paid: true  } },
        { $group: { _id: '$referred_by', score: { $sum: 1 } } },
        { $sort: { score: -1 } },
        { $limit: 35 },
        { $lookup: { from: 'users', localField: '_id', foreignField: 'user_id', as: 'u' } },
        { $unwind: '$u' },
        { $match: { 'u.is_banned': { $ne: true } } },
        { $limit: 25 },
        { $project: { _id: 0, user_id: '$_id', score: 1, first_name: '$u.first_name', username: '$u.username' } }
    ]);

    const leaderboard = top.map((u, idx) => ({
        rank: idx + 1,
        user_id: u.user_id,
        name: u.first_name || u.username || `User ${u.user_id}`,
        score: u.score,
        isYou: u.user_id === userId
    }));

    let myEntry = leaderboard.find(e => e.isYou);
    if (!myEntry) {
        const myScore = await User.countDocuments({ referred_by: userId });
        const higher = await User.aggregate([
            { $match: { referred_by: { $ne: null }, referral_paid: true } },
            { $group: { _id: '$referred_by', n: { $sum: 1 } } },
            { $match: { n: { $gt: myScore } } },
            { $count: 'c' }
        ]);
        myEntry = {
            rank: (higher[0]?.c || 0) + 1,
            user_id: userId,
            name: 'You',
            score: myScore,
            isYou: true,
            outsideTop: true
        };
    }
    return { leaderboard, myEntry };
}

router.get('/api/secure/leaderboard', validateInitData, async (req, res) => {
    try {
        const type = req.query.type === 'invites' ? 'invites' : 'points';
        const userId = req.tgUser.id;

        if (type === 'invites') {
            const { leaderboard, myEntry } = await inviteLeaderboard(userId);
            return res.json({ success: true, type, leaderboard, myRank: myEntry });
        }

        const sortField = 'balance';
        const topUsers = await User.find({ is_banned: false })
            .select(`user_id username first_name ${sortField}`)
            .sort({ [sortField]: -1 })
            .limit(25)
            .lean();

        const leaderboard = topUsers.map((u, idx) => ({
            rank: idx + 1,
            user_id: u.user_id,
            name: u.first_name || u.username || `User ${u.user_id}`,
            score: u[sortField] || 0,
            isYou: u.user_id === userId
        }));

        let myEntry = leaderboard.find(e => e.isYou);
        if (!myEntry) {
            const myUser = await User.findOne({ user_id: userId }).select(sortField).lean();
            const myScore = myUser ? (myUser[sortField] || 0) : 0;
            const higherCount = await User.countDocuments({ is_banned: false, [sortField]: { $gt: myScore } });
            myEntry = {
                rank: higherCount + 1,
                user_id: userId,
                name: 'You',
                score: myScore,
                isYou: true,
                outsideTop: true
            };
        }

        return res.json({ success: true, type, leaderboard, myRank: myEntry });
    } catch (err) {
        console.error("Leaderboard fetch error:", err);
        return res.status(500).json({ error: "Failed to load leaderboard." });
    }
});

module.exports = router;
