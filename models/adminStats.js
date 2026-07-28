const express = require('express');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const { admins } = require('../config/constants');
const { User, Task, ActiveAd, AdminActivity } = require('../models');
const { getSettings } = require('../utils/settings');

router.get('/api/admin/stats', validateAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalTasks = await Task.countDocuments();
        const settings = await getSettings();

        // points field = USDT in our currency system
        const totalUsdtInSystem = await User.aggregate([
            { $group: { _id: null, total: { $sum: "$points" } } }
        ]);

        res.json({
            users: totalUsers,
            tasks: totalTasks,

            maintenance: settings.maintenance_mode,
            ref_bonus: settings.ref_bonus_amount,
            ref_percent: settings.ref_commission_percent
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


router.get('/api/admin/registry', validateAdmin, async (req, res) => {
    try {
        const adminUsers = await User.find({ user_id: { $in: admins } })
            .select('user_id username first_name last_admin_active');

        const registryList = admins.map(id => {
            const match = adminUsers.find(u => u.user_id === id);
            return {
                user_id: id,
                username: match?.username || null,
                first_name: match?.first_name || null,
                last_active: match?.last_admin_active || null
            };
        });

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activity = await AdminActivity.find({ timestamp: { $gte: since } }).sort({ timestamp: -1 }).limit(100);

        res.json({ admins: registryList, activity });
    } catch (e) {
        console.error('Registry fetch failed:', e);
        res.status(500).json({ error: 'Failed to load registry' });
    }
});


router.get('/api/admin/test', validateAdmin, async (req, res) => {
    try {
        const count = await ActiveAd.countDocuments({});
        res.json({ success: true, adCount: count, user: req.adminUser?.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
