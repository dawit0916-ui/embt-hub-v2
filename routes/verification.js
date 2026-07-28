const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const bot = require('../bot/bot');
const { admins } = require('../config/constants');
const { TelegramVerification } = require('../models');

// ==========================================================================
// Admin Status Check
// ==========================================================================
router.get('/api/admin/check', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser?.id;
        if (!userId) {
            return res.status(401).json({ isAdmin: false, error: "Unauthorized" });
        }

        const isAdmin = admins.includes(userId);

        res.json({
            success: true,
            isAdmin: isAdmin,
            userId: userId,
            adminList: isAdmin ? admins : [] // Only show admin list to admins
        });

    } catch (err) {
        console.error("Admin check error:", err);
        res.status(500).json({ success: false, error: "Admin check failed" });
    }
});

router.post('/api/verify-membership', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const CHANNEL_ID = process.env.CHANNEL_ID; // e.g. "@FlamesChannel"
        const GROUP_ID   = process.env.GROUP_ID;   // e.g. "@FlamesCommunity"

        async function checkMember(chatId) {
            try {
                const m = await bot.telegram.getChatMember(chatId, userId);
                return ['creator','administrator','member','restricted'].includes(m.status);
            } catch(e) {
                console.warn(`getChatMember failed for ${chatId}:`, e.message);
                return false;
            }
        }

        const [inChannel, inGroup] = await Promise.all([
            checkMember(CHANNEL_ID),
            checkMember(GROUP_ID)
        ]);

        const verified = inChannel && inGroup;

        // Cache result
        await TelegramVerification.updateOne(
            { userId },
            { $set: { inChannel, inGroup, verified, lastChecked: new Date() } },
            { upsert: true }
        );

        return res.json({ verified, inChannel, inGroup });

    } catch (err) {
        console.error('Verify membership error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
