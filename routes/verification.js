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

const MAX_TELEGRAM_CHECKS_PER_DAY = 3;

router.post('/api/verify-membership', validateInitData, async (req, res) => {
    try {
        const userId = Number(req.tgUser?.id);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const CHANNEL_ID = process.env.CHANNEL_ID;
        const GROUP_ID   = process.env.GROUP_ID;
        const today = new Date().toISOString().slice(0, 10); // UTC day

        // Make sure a record exists
        try {
            await TelegramVerification.updateOne(
                { userId }, { $setOnInsert: { userId } }, { upsert: true }
            );
        } catch (e) { if (e.code !== 11000) throw e; }

        // New UTC day -> reset the counter
        await TelegramVerification.updateOne(
            { userId, checksDay: { $ne: today } },
            { $set: { checksDay: today, checksToday: 0 } }
        );

        // Atomically take one of today's slots
        const slot = await TelegramVerification.findOneAndUpdate(
            { userId, checksToday: { $lt: MAX_TELEGRAM_CHECKS_PER_DAY } },
            { $inc: { checksToday: 1 } },
            { new: true }
        );

        // Limit reached -> answer from cache, no Telegram call
        if (!slot) {
            const cached = await TelegramVerification.findOne({ userId }).lean();
            return res.json({
                verified: !!cached?.verified,
                inChannel: !!cached?.inChannel,
                inGroup: !!cached?.inGroup,
                limited: true
            });
        }

        // null = Telegram errored (unknown), true/false = real answer
        async function checkMember(chatId) {
            try {
                const m = await bot.telegram.getChatMember(chatId, userId);
                return ['creator', 'administrator', 'member', 'restricted'].includes(m.status);
            } catch (e) {
                console.warn(`getChatMember failed for ${chatId}:`, e.message);
                return null;
            }
        }

        const [ch, gr] = await Promise.all([checkMember(CHANNEL_ID), checkMember(GROUP_ID)]);

        // On a Telegram error keep the last known value instead of overwriting it with false
        const prev = slot;
        const inChannel = ch === null ? !!prev.inChannel : ch;
        const inGroup   = gr === null ? !!prev.inGroup   : gr;
        const verified  = inChannel && inGroup;

        await TelegramVerification.updateOne(
            { userId },
            { $set: { inChannel, inGroup, verified, lastChecked: new Date() } }
        );

        return res.json({ verified, inChannel, inGroup, tgError: ch === null || gr === null });

    } catch (err) {
        console.error('Verify membership error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
