const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const bot = require('../bot/bot');
const { admins } = require('../config/constants');
const { User } = require('../models');


router.get('/api/secure/profile', validateInitData, async (req, res) => {
    try {
        if (!req.tgUser || !req.tgUser.id) {
            return res.status(401).json({ error: "Unauthorized: Missing authentication token context." });
        }

        const userId = Number(req.tgUser.id);
        let user = await User.findOne({ user_id: userId });

        if (user) {
            if (user.pending_message_cleanup && user.pending_message_cleanup.length > 0) {
                for (const msgId of user.pending_message_cleanup) {
                    try {
                        await bot.telegram.deleteMessage(userId, msgId);
                    } catch (err) {
                        console.log(`Failed to delete message ${msgId} for ${userId}:`, err.message);
                    }
                }
                await User.updateOne({ user_id: userId }, { $set: { pending_message_cleanup: [] } });
            }

            // --- NEW: rank / percentile (based on balance, same metric as leaderboard "points" tab) ---
            const totalUsers = await User.countDocuments({ is_banned: false });
            const higherCount = await User.countDocuments({
                is_banned: false,
                balance: { $gt: user.balance || 0 }
            });
            const rank = higherCount + 1;
            const topPercent = totalUsers > 0 ? Math.max(1, Math.round((rank / totalUsers) * 100)) : null;

            

            const accountMetricsPayload = {
                success: true,
                user_id: user.user_id,
                first_name: user.first_name || 'User',
                balance: user.balance || 0,
                level: user.level || 0,
                total_earned: user.total_earned || 0,
                referrals: user.referralCount || 0,
                tasksCompletedCount: user.completed_tasks ? user.completed_tasks.length : 0,
                completed_tasks: user.completed_tasks || [],
                is_banned: user.is_banned || false,
                red_flag: user.red_flag || false,
                tasks_added: user.tasks_added || 0,
                createdAt: user.createdAt,
                isAdmin: typeof admins !== 'undefined' ? admins.includes(userId) : false,

                // NEW fields
                currentStreak: user.currentStreak,
                longestStreak: user.longestStreak,
                rank,
                totalUsers,
                topPercent
                
            };

            return res.json({
                ...accountMetricsPayload,
                profile: accountMetricsPayload
            });

        } else {
            const defaultEmptyPayload = {
                success: false,
                balance: 0,
                level: 0,
                total_earned: 0,
                referrals: 0,
                tasksCompletedCount: 0,
                tasks_added: 0,
                is_banned: false,
                red_flag: false,
                isAdmin: false,
                currentStreak: 0,
                longestStreak: 0,
                rank: null,
                totalUsers: null,
                topPercent: null
                
            };

            return res.json({
                ...defaultEmptyPayload,
                profile: defaultEmptyPayload
            });
        }

    } catch (err) {
        console.error("Secure profile extraction protocol engine error stack trace:", err);
        return res.status(500).json({ error: "Internal Context Security Pipeline Fault" });
    }
});

module.exports = router;
