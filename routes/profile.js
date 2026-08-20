const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const bot = require('../bot/bot');
const { admins } = require('../config/constants');
const { User } = require('../models');

router.get('/api/secure/profile', validateInitData, async (req, res) => {
    try {
        // 1. TRUST THE MIDDLEWARE: validateInitData has already cryptographically verified the user
        // and populated 'req.tgUser' securely!
        if (!req.tgUser || !req.tgUser.id) {
            return res.status(401).json({ error: "Unauthorized: Missing authentication token context." });
        }

        const userId = Number(req.tgUser.id);

        // 2. Query your database collection directly using the verified Telegram account ID
        const user = await User.findOne({ user_id: userId });

        if (user) {
            // Optional: Handle cleanup of welcome message if tracked
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

            // 3. Build a fully mapped data profile configuration matrix block
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
                isAdmin: typeof admins !== 'undefined' ? admins.includes(userId) : false
            };

            // Return BOTH structural patterns to satisfy all frontend setup variations perfectly
            return res.json({
                ...accountMetricsPayload,
                profile: accountMetricsPayload // Matches the 'data.profile' frontend verification path
            });

        } else {
            // Fallback object initialization if a record hasn't synced into the system yet
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
                isAdmin: false
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
