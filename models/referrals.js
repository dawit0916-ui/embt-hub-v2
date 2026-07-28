const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const { User, ReferralEarning } = require('../models');

router.get('/api/secure/referrals', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const friends = await User.find({ referred_by: userId })
            .select('user_id username first_name completed_tasks');

        const friendIds = friends.map(f => f.user_id);
        const earnings = await ReferralEarning.find({
            referrerId: userId,
            friendId: { $in: friendIds }
        }).lean();

        const earningsMap = {};
        earnings.forEach(e => { earningsMap[e.friendId] = e.totalEarned; });

        res.json({
            success: true,
            friends: friends.map(f => ({
                username: f.username || `User_${f.user_id}`,
                first_name: f.first_name || f.username || 'Friend',
                tasks_done: f.completed_tasks ? f.completed_tasks.length : 0,
                commission_earned: earningsMap[f.user_id] || 0
            }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
