const express = require('express');
const router = express.Router();

const { AdWatch } = require('../models');

router.get('/api/adsgram/reward-callback', async (req, res) => {
    try {
        const { userId, sessionId } = req.query;

        // Verify the secret token AdsGram sends
        const secret = req.query.secret || req.headers['x-adsgram-secret'];
        if (secret !== process.env.ADSGRAM_SECRET) {
            console.warn('[AdsGram S2S] Bad secret from IP:', req.ip);
            return res.status(403).send('Forbidden');
        }

         if (!userId) {
            return res.status(400).send('Missing userId');
        }

        // In the S2S callback, find by userId + adId instead of sessionId
        const session = await AdWatch.findOne({
            userId: Number(userId),
            serverConfirmed: false,
            claimed: false
        }).sort({ createdAt: -1 }); // most recent pending session
        if (!session) {
            // Already confirmed or session expired — return 200 so AdsGram doesn't retry
            return res.status(200).send('ok');
        }

        session.serverConfirmed = true;
        await session.save();

        console.log(`[AdsGram S2S] Confirmed session ${sessionId} for user ${userId}`);
        return res.status(200).send('ok');

    } catch (err) {
        console.error('[AdsGram S2S] Callback error:', err);
        return res.status(500).send('error');
    }
});


router.get('/api/ads/monetag-reward-callback', async (req, res) => {
    try {
        const { ymid, event, value, telegram_id } = req.query;
        console.log('[Monetag S2S] Raw query:', req.query);
        const userId = Number(telegram_id);

        if (value === 'valued' && userId) {
            const session = await AdWatch.findOne({
                userId,
                adNetwork: 'monetag',
                claimed: false,
                serverConfirmed: false
            }).sort({ createdAt: -1 });

            if (session) {
                session.serverConfirmed = true;
                await session.save();
            }
        }

        return res.status(200).send('ok');
    } catch (err) {
        console.error('Monetag postback error:', err);
        return res.status(200).send('ok');
    }
});

module.exports = router;
