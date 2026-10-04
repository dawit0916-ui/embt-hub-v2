const express = require('express');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { User, ReferralEarning, AdminActivity } = require('../models');
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
            .select('user_id username balance is_banned')
            .sort({ createdAt: -1 });

        // Map data properties clean to prevent front-end mapping crashes
        const structuralPayload = userDirectory.map(user => ({
            user_id: user.user_id,
            username: user.username || null,
            balance: user.balance || 0,
            
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
        const ids = usersList.map(u => u.user_id);
        const countRows = await User.aggregate([
            { $match: { referred_by: { $in: ids } } },
            { $group: { _id: '$referred_by', total: { $sum: 1 }, active: { $sum: { $cond: ['$referral_paid', 1, 0] } } } }
        ]);
        const refMap = {};
        countRows.forEach(r => { refMap[r._id] = r; });

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
                referralCount: refMap[u.user_id]?.total || 0,
                activeReferrals: refMap[u.user_id]?.active || 0,
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

        const before = await User.findOne({ user_id: Number(target_user_id) })
            .select('balance is_banned red_flag').lean();
        if (!before) {
            return res.status(404).json({ error: "User configuration track not found in collection tracking database." });
        }

        let dynamicUpdates = {};
        if (balance !== undefined) dynamicUpdates.balance = Number(balance);
        if (is_banned !== undefined) dynamicUpdates.is_banned = Boolean(is_banned);
        if (red_flag !== undefined) dynamicUpdates.red_flag = Boolean(red_flag);

        const updatedUser = await User.findOneAndUpdate(
            { user_id: Number(target_user_id) },
            { $set: dynamicUpdates },
            { new: true }
        );

        // --- AUDIT: only record fields that actually changed ---
        const changes = [];
        for (const field of Object.keys(dynamicUpdates)) {
            const oldVal = before[field] ?? (typeof dynamicUpdates[field] === 'boolean' ? false : 0);
            if (oldVal !== dynamicUpdates[field]) {
                changes.push({ field, from: oldVal, to: dynamicUpdates[field] });
            }
        }
        if (changes.length) {
            await logAdminAction(
                req.adminUser,
                'user_edited',
                `Edited user ${target_user_id}: ` + changes.map(c => `${c.field} ${c.from} → ${c.to}`).join(', '),
                { target_user_id: Number(target_user_id), changes }
            );
        }

        return res.json({
            success: true,
            message: `User ${target_user_id} parameters updated successfully.`,
            user: {
                user_id: updatedUser.user_id,
                balance: updatedUser.balance,
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
        await logAdminAction(
            req.adminUser,
            banned ? 'user_banned' : 'user_unbanned',
            `User ${userId}`,
            { target_user_id: Number(userId), changes: [{ field: 'is_banned', from: !banned, to: !!banned }] }
        
        );
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

// 🔗 REFERRAL CONNECTION MAP: who invited this user + who they invited
router.get('/api/admin/user/:id/referrals', validateAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const pick = 'user_id first_name username referred_by referral_paid is_banned red_flag createdAt';

        const me = await User.findOne({ user_id: id }).select(pick).lean();
        if (!me) return res.status(404).json({ error: 'User not found.' });

        // Upline chain (walk up referred_by, max 5 levels, loop-safe)
        const upline = [];
        const seen = new Set([id]);
        let cursor = me.referred_by;
        while (cursor && upline.length < 5 && !seen.has(cursor)) {
            seen.add(cursor);
            const u = await User.findOne({ user_id: cursor }).select(pick).lean();
            if (!u) { upline.push({ user_id: cursor, missing: true }); break; }
            upline.push(u);
            cursor = u.referred_by;
        }

        // Direct downline + what each friend earned this user
        const [friends, earnings] = await Promise.all([
            User.find({ referred_by: id }).select(pick).sort({ createdAt: -1 }).limit(200).lean(),
            ReferralEarning.find({ referrerId: id }).lean()
        ]);
        const earnMap = {};
        earnings.forEach(e => { earnMap[e.friendId] = e.totalEarned; });

        // Grand-downline counts (level 2) per friend, in one query
        const friendIds = friends.map(f => f.user_id);
        const subRows = await User.aggregate([
            { $match: { referred_by: { $in: friendIds } } },
            { $group: { _id: '$referred_by', n: { $sum: 1 } } }
        ]);
        const subMap = {};
        subRows.forEach(r => { subMap[r._id] = r.n; });

        const slim = u => u.missing ? u : ({
            user_id: u.user_id, first_name: u.first_name || 'Member', username: u.username || null,
            is_banned: !!u.is_banned, red_flag: !!u.red_flag, activated: !!u.referral_paid, createdAt: u.createdAt
        });

        return res.json({
            success: true,
            me: slim(me),
            upline: upline.map(slim),                       // [0] = direct inviter, then their inviter...
            downline: friends.map(f => ({
                ...slim(f),
                earned_for_referrer: earnMap[f.user_id] || 0,
                their_referrals: subMap[f.user_id] || 0
            })),
            totals: {
                friends: friends.length,
                activated: friends.filter(f => f.referral_paid).length,
                commission: earnings.reduce((s, e) => s + (e.totalEarned || 0), 0)
            }
        });
    } catch (err) {
        console.error('Referral map error:', err);
        return res.status(500).json({ error: 'Failed to load referral map.' });
    }
});

// 🧾 AUDIT HISTORY: every admin edit made to this user
router.get('/api/admin/user/:id/audit', validateAdmin, async (req, res) => {
    try {
        const logs = await AdminActivity.find({ target_user_id: Number(req.params.id) })
            .sort({ timestamp: -1 }).limit(50).lean();
        return res.json({ success: true, logs });
    } catch (err) {
        console.error('Audit history error:', err);
        return res.status(500).json({ error: 'Failed to load audit history.' });
    }
});
module.exports = router;
