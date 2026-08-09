const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const { ActiveAd, AdWatch, User, CompletedTask } = require('../models');
const { getResetPeriodStart } = require('../utils/time');
const { logAdminAction } = require('../utils/logAdminAction');
const { FAST_TASK_ADSGRAM_BLOCK_ID } = require('../config/constants');

router.post('/api/secure/ads/start-session', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { adId } = req.body;
        if (!adId) return res.status(400).json({ error: 'adId required' });

        const ad = await ActiveAd.findOne({ adId, enabled: true });
        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        // Use dynamic reset interval
        const periodStart    = getResetPeriodStart(ad.resetIntervalHours || 24);
        const watchesPerReset = ad.watchesPerReset || 2;

        const watchedThisPeriod = await AdWatch.countDocuments({
            userId,
            adId,
            claimed: true,
            createdAt: { $gte: periodStart }
        });

        if (watchedThisPeriod >= watchesPerReset) {
            const nextReset = new Date(periodStart);
            nextReset.setUTCHours(nextReset.getUTCHours() + (ad.resetIntervalHours || 24));
            return res.status(400).json({
                error: 'Limit reached for this period.',
                nextReset: nextReset.toISOString()
            });
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        await AdWatch.create({
            sessionId,
            userId,
            adId,
            adNetwork: ad.network,
            reward: ad.reward
        });

        return res.json({ success: true, sessionId });
    } catch (err) {
        console.error('Start ad session error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/api/secure/ads/claim', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { sessionId, blurDetected } = req.body;

        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

        const session = await AdWatch.findOne({
            sessionId,
            userId,
            claimed: false
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found or already claimed' });
        }
        // ✅ NEW: Require blur detection (CTA engagement proof)
        if (!blurDetected) {
            return res.status(400).json({
                error: 'You Must Click The Button in AD.',
                pending: false
            });
        }
        if (!session.serverConfirmed) {
            // S2S ping hasn't arrived yet — tell frontend to retry
            return res.status(202).json({
                success: false,
                pending: true,
                error: 'Ad reward not yet confirmed by server. Please wait a moment.'
            });
        }

        // All checks passed — credit reward
        session.claimed = true;
        await session.save();

        const updatedUser = await User.findOneAndUpdate(
            { user_id: userId },
            {
                $inc: { balance: session.reward, total_earned: session.reward },
                $push: {
                    history: {
                        title: `Ad Watch Reward`,
                        reward: session.reward,
                        taskId: `ad_${session.adId}`,
                        date: new Date()
                    }
                }
            },
            { new: true }
        );

        return res.json({
            success: true,
            reward: session.reward,
            newBalance: updatedUser.balance

        });

    } catch (err) {
        console.error('Claim ad error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==========================================================================
// WATCH & EARN SYSTEM ENDPOINTS
// ==========================================================================
// GET all ads for admin panel
router.get('/api/admin/ads', validateAdmin, async (req, res) => {
    try {
        const ads = await ActiveAd.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, ads });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// UPDATE ad settings dynamically
router.post('/api/admin/ads/update', validateAdmin, async (req, res) => {
    try {
        const { adId, reward, resetIntervalHours, watchesPerReset, enabled } = req.body;
        if (!adId) return res.status(400).json({ error: 'adId required' });

        const updates = {};
        if (reward             !== undefined) updates.reward             = parseFloat(reward);
        if (resetIntervalHours !== undefined) updates.resetIntervalHours = parseInt(resetIntervalHours);
        if (watchesPerReset    !== undefined) updates.watchesPerReset    = parseInt(watchesPerReset);
        if (enabled            !== undefined) updates.enabled            = Boolean(enabled);

        const ad = await ActiveAd.findOneAndUpdate(
            { adId },
            { $set: updates },
            { new: true }
        );

        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        await logAdminAction(req.adminUser, 'ad_updated',
            `Updated ad ${adId}: ${JSON.stringify(updates)}`
        );

        res.json({ success: true, ad });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get available ads for user (max 2 per day)
router.get('/api/secure/available-ads', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const allAds = await ActiveAd.find({ enabled: true });

        const adsWithStatus = await Promise.all(
            allAds.map(async (ad) => {
                const resetIntervalHours = ad.resetIntervalHours || 24;
                const watchesPerReset    = ad.watchesPerReset    || 4;

                const periodStart = getResetPeriodStart(resetIntervalHours);

                // Next reset timestamp
                const nextReset = new Date(periodStart);
                nextReset.setUTCHours(nextReset.getUTCHours() + resetIntervalHours);

                const watchedThisPeriod = await AdWatch.countDocuments({
                    userId,
                    adId: ad.adId,
                    claimed: true,
                    createdAt: { $gte: periodStart }
                });

                return {
                    id:                 ad.adId,
                    network:            ad.network,
                    unitId:             ad.unitId,
                    reward:             ad.reward,
                    watchesPerReset,
                    resetIntervalHours,
                    watchedThisPeriod,
                    nextReset:          nextReset.toISOString(),
                    locked:             watchedThisPeriod >= watchesPerReset
                };
            })
        );

        return res.json({ success: true, ads: adsWithStatus });
    } catch (err) {
        console.error('Get ads error:', err);
        res.status(500).json({ error: 'Failed to load ads' });
    }
});

// Record that user watched an ad (call this AFTER ad completes)
router.post('/api/secure/watch-ad', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { adId } = req.body;

        if (!adId) return res.status(400).json({ error: 'Ad ID required' });

        const ad = await ActiveAd.findOne({ adId, enabled: true });
        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyLimit = ad.maxWatchesPerDay || 1;
        const watchedToday = await AdWatch.countDocuments({
            userId,
            adId,
            viewedAt: { $gte: today }
        });

        if (watchedToday >= dailyLimit) {
            return res.status(400).json({ error: 'Daily watch limit reached for this ad' });
        }

        await AdWatch.create({
            userId,
            adId,
            adNetwork: ad.network,
            reward: ad.reward,
            watched: true
        });

        return res.json({ success: true, reward: ad.reward, watchedToday: watchedToday + 1, dailyLimit });
    } catch (err) {
        console.error('Watch ad error:', err);
        res.status(500).json({ error: 'Failed to record watch' });
    }
});

// ==========================================================================
// FAST TASK (AdsGram task-widget) — available to all users regardless of
// level. 3 claims/day, 100 DASH each. No admin config UI on purpose — the
// block ID is a fixed env var (config/constants.js) and the reward/limit
// are fixed constants below. Uses CompletedTask (not AdWatch) for daily
// tracking since AdWatch auto-deletes after 10 minutes (fine for its
// original short-lived session flow, wrong for a full-day claim limit).
// ==========================================================================
const FAST_TASK_DAILY_LIMIT = 3;
const FAST_TASK_REWARD = 100;

function fastTaskDateKey() {
    return new Date().toISOString().slice(0, 10);
}

router.get('/api/secure/fast-task-config', validateInitData, async (req, res) => {
    try {
        const user = await User.findOne({ user_id: req.tgUser.id }).select('level');
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const dateKey = fastTaskDateKey();
        const claimsToday = await CompletedTask.countDocuments({ userId: req.tgUser.id, taskType: 'fast_task', dateKey });

        return res.json({
            success: true,
            enabled: !!FAST_TASK_ADSGRAM_BLOCK_ID,
            blockId: FAST_TASK_ADSGRAM_BLOCK_ID,
            reward: FAST_TASK_REWARD,
            dailyLimit: FAST_TASK_DAILY_LIMIT,
            claimsRemainingToday: Math.max(0, FAST_TASK_DAILY_LIMIT - claimsToday)
        });
    } catch (err) {
        console.error('Fast task config error:', err);
        res.status(500).json({ success: false, error: 'Failed to load config' });
    }
});

router.post('/api/secure/fast-task-claim', validateInitData, async (req, res) => {
    const userId = req.tgUser.id;
    const session = await mongoose.startSession();

    try {
        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        if (user.is_banned) return res.status(403).json({ success: false, error: 'Account banned' });

        const dateKey = fastTaskDateKey();
        let result = null;

        // Everything inside here either fully commits (claim recorded AND
        // balance credited) or fully rolls back on any error — no more
        // possibility of "slot marked used, reward never paid", which is
        // exactly the bug that caused claims to silently disappear before:
        // the claim record and the balance update weren't atomic, so any
        // failure between the two steps left a permanently unpaid claim.
        await session.withTransaction(async () => {
            let claimed = false;
            let finalClaimsToday = 0;

            for (let attempt = 0; attempt < FAST_TASK_DAILY_LIMIT + 1; attempt++) {
                const claimsToday = await CompletedTask.countDocuments({ userId, taskType: 'fast_task', dateKey }).session(session);

                if (claimsToday >= FAST_TASK_DAILY_LIMIT) {
                    result = { status: 400, body: { success: false, error: `Daily limit reached (${claimsToday}/${FAST_TASK_DAILY_LIMIT})` } };
                    return;
                }

                try {
                    await CompletedTask.create([{ userId, taskType: 'fast_task', taskKey: `fasttask_${claimsToday + 1}`, dateKey }], { session });
                    claimed = true;
                    finalClaimsToday = claimsToday;
                    break;
                } catch (createErr) {
                    if (createErr.code === 11000) continue; // slot taken by a concurrent request — retry next slot
                    throw createErr;
                }
            }

            if (!claimed) {
                result = { status: 400, body: { success: false, error: 'Daily limit reached' } };
                return;
            }

            const updatedUser = await User.findOneAndUpdate(
                { user_id: userId },
                { $inc: { balance: FAST_TASK_REWARD, total_earned: FAST_TASK_REWARD } },
                { new: true, session }
            );

            result = {
                status: 200,
                body: {
                    success: true,
                    reward: FAST_TASK_REWARD,
                    newBalance: updatedUser.balance,
                    claimsRemainingToday: FAST_TASK_DAILY_LIMIT - (finalClaimsToday + 1)
                }
            };
        });

        return res.status(result.status).json(result.body);

    } catch (err) {
        console.error('Fast task claim error:', err);
        res.status(500).json({ success: false, error: 'Failed to record claim' });
    } finally {
        await session.endSession();
    }
});

module.exports = router;
