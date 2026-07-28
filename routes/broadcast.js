const express = require('express');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { User } = require('../models');
const { logAdminAction } = require('../utils/logAdminAction');

router.post('/api/admin/broadcast', validateAdmin, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Blank body payload allocation" });
    const users = await User.find({}, 'user_id');
    await logAdminAction(req.adminUser, 'broadcast_sent', `Sent to ${users.length} users`);
    res.json({ success: true, total: users.length });

    (async () => {
        for (const user of users) {
            try { await bot.telegram.sendMessage(user.user_id, message, { parse_mode: 'HTML' }); } catch (err) {}
            await new Promise(resolve => setTimeout(resolve, 75));
        }
    })();
});

module.exports = router;
