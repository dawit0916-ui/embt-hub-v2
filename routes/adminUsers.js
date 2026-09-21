const express = require('express');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { User } = require('../models');
const { logAdminAction } = require('../utils/logAdminAction');

router.get('/api/admin/directory', validateAdmin, async (req, res) => {
    try {
        const filterType = req.query.filter || 'all';
        let databaseQuery = {};

        // Filter out users conditionally based on the tab selection state
        if (filterType === 'banned') {
            databaseQuery.is_banned = true;
        }

        // Pull documents matching your model schema properties
        const userDirectory = await User.find(databaseQuery)
            .select('user_id username balance points is_banned')
            .sort({ createdAt: -1 });

        // Map data properties clean to prevent front-end mapping crashes
        const structuralPayload = userDirectory.map(user => ({
            user_id: user.user_id,
            username: user.username || null,
            balance: user.balance || 0,
            points: user.points || 0.00,
            coins: user.coins || 0.00,
            is_banned: user.is_banned || false
        }));

        return res.status(200).json(structuralPayload);
    } catch (error) {
        console.error("Error executing directory dataset dump query:", error);
        return res.status(500).json({ success: false, error: 'Database service query failure mapping user collections.' });
    }
});

// 📊 GET USER DIRECTORY (With Pagination, Search, and Status Filtering)
router.get('/api/admin/users', validateAdmin, async (req, res) => {
    try {
        // 1. Parse Query Parameters for Pagination & Filters
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20)); // Caps max rows at 100 per page
        const skip = (page - 1) * limit;

        const searchQuery = req.query.search || '';
        const filterStatus = req.query.filter || 'all'; // Options: all, banned, flagged

        // 2. Build Dynamic MongoDB Query Object
        let databaseQuery = {};

        // If there's a search keyword, check if it's a numeric Telegram ID or a string username
        if (searchQuery) {
            if (!isNaN(searchQuery)) {
                databaseQuery.user_id = Number(searchQuery);
            } else {
                databaseQuery.username = { $regex: searchQuery, $options: 'i' }; // Case-insensitive partial matching
            }
        }

        // Apply specialized status layout filter matrices
        if (filterStatus === 'banned') databaseQuery.is_banned = true;
        if (filterStatus === 'flagged') databaseQuery.red_flag = true;

        // 3. Execute Efficient Parallel Queries
        const [usersList, totalRecordsCount] = await Promise.all([
            User.find(databaseQuery)
                .sort({ createdAt: -1 }) // Shows newest members first
                .skip(skip)
                .limit(limit)
                .lean(), // Boosts read performance dramatically
            User.countDocuments(databaseQuery)
        ]);

        // 4. Return Clean Scalable Pagination Metadata Object Payload
        return res.json({
            success: true,
            meta: {
                totalUsers: totalRecordsCount,
                currentPage: page,
                totalPages: Math.ceil(totalRecordsCount / limit),
                perPage: limit
            },
            users: usersList.map(u => ({
                user_id: u.user_id,
                username: u.username || 'N/A',
                first_name: u.first_name || 'Member',
                balance: u.balance || 0,
                
                total_earned: u.total_earned || 0,
                referralCount: u.referralCount || 0,
                tasksCompleted: u.completed_tasks ? u.completed_tasks.length : 0,
                is_banned: u.is_banned || false,
                red_flag: u.red_flag || false,
                createdAt: u.createdAt || null
            }))
        });

    } catch (err) {
        console.error("Professional admin list compilation failure:", err);
        return res.status(500).json({ error: "Internal Admin Directory Engine Fault" });
    }
});



// 🛠️ POST UPDATE MODIFIER (Instantly modify users from your front-end interface)
router.post('/api/admin/user/update', validateAdmin, async (req, res) => {
    try {
        const { target_user_id, balance, is_banned, red_flag } = req.body;

        if (!target_user_id) {
            return res.status(400).json({ error: "Target Identity Specification parameter is missing." });
        }

        // 1. Map incoming payload adjustments cleanly into an update object
        let dynamicUpdates = {};
        if (balance !== undefined) dynamicUpdates.balance = Number(balance);
        if (is_banned !== undefined) dynamicUpdates.is_banned = Boolean(is_banned);
        if (red_flag !== undefined) dynamicUpdates.red_flag = Boolean(red_flag);

        // 2. Perform the atomic update directly inside your MongoDB instance
        const updatedUser = await User.findOneAndUpdate(
            { user_id: Number(target_user_id) },
            { $set: dynamicUpdates },
            { new: true } // Returns the newly modified state document
        );

        if (!updatedUser) {
            return res.status(404).json({ error: "User configuration track not found in collection tracking database." });
        }

        // 3. Send confirmation payload back to admin panel view
        return res.json({
            success: true,
            message: `User ${target_user_id} parameters updated successfully.`,
            user: {
                user_id: updatedUser.user_id,
                balance: updatedUser.balance,
                points: updatedUser.points,
                coins: updatedUser.coins,
                is_banned: updatedUser.is_banned,
                red_flag: updatedUser.red_flag
            }
        });

    } catch (err) {
        console.error("Admin real-time document write failure:", err);
        return res.status(500).json({ error: "Direct Update Modifier Transaction Aborted." });
    }
});

//

// 2. Ban/unban user
router.post('/api/admin/users/ban', validateAdmin, async (req, res) => {
    try {
        const { userId, banned } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID required." });

        const updatedUser = await User.findOneAndUpdate(
            { user_id: Number(userId) },
            { $set: { is_banned: Boolean(banned) } },
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ error: "User not found." });
        await logAdminAction(req.adminUser, banned ? 'user_banned' : 'user_unbanned', `User ${userId}`);
        // Notify user via bot
        try {
            const msg = banned
                ? "🚫 Your account has been suspended. Contact support if you believe this is an error."
                : "✅ Your account has been reinstated. Welcome back!";
            await bot.telegram.sendMessage(Number(userId), msg);
        } catch (e) {}

        return res.json({ success: true, is_banned: updatedUser.is_banned });

    } catch (err) {
        console.error("Ban user error:", err);
        return res.status(500).json({ error: "Failed to update ban status." });
    }
});

module.exports = router;
