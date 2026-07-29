const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { User, LevelConfig } = require('../models');
const { logAdminAction } = require('../utils/logAdminAction');

// =====================================================
// LEVEL SYSTEM USER ENDPOINTS
// =====================================================

// GET current user level + unlocked features
router.get('/api/secure/user/level', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const user = await User.findOne({ user_id: userId })
            .select('level purchased_levels features_unlocked balance');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({
            success: true,
            level: user.level || 0,
            purchased_levels: user.purchased_levels || [],
            features_unlocked: user.features_unlocked || {},
            balance: user.balance || 0
        });
    } catch (err) {
        console.error('Get user level error:', err);
        res.status(500).json({ error: 'Failed to load level' });
    }
});


// PURCHASE a level with DASH
router.post('/api/secure/level/purchase', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { level } = req.body;

        if (!level || level < 1 || level > 10) {
            return res.status(400).json({ error: 'Invalid level (1-10)' });
        }

        // 1. Get user
        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.is_banned) return res.status(403).json({ error: 'Account banned' });

        // 2. Check if already purchased
        if (user.purchased_levels && user.purchased_levels.includes(level)) {
            return res.status(400).json({ error: 'Level already purchased' });
        }

        // 3. Must purchase sequentially (buy level 1 before level 2)
        const nextAvailableLevel = (user.level || 0) + 1;
        if (level !== nextAvailableLevel) {
            return res.status(400).json({
                error: `Must purchase levels sequentially. Next available: Level ${nextAvailableLevel}`
            });
        }

        // 4. Get level config
        const levelConfig = await LevelConfig.findOne({ level });
        if (!levelConfig) {
            return res.status(404).json({ error: 'Level configuration not found' });
        }

        // 5. Check balance
        if (user.balance < levelConfig.cost) {
            return res.status(400).json({
                error: `Insufficient balance. Need ${levelConfig.cost} DASH, you have ${user.balance}`
            });
        }

        // 6. Build features_unlocked object for this level
        let features_unlocked = user.features_unlocked || {};
        if (levelConfig.features) {
            levelConfig.features.forEach(feature => {
                features_unlocked[feature] = true;
            });
        }

        // 7. Deduct cost & add level
        const updatedUser = await User.findOneAndUpdate(
            { user_id: userId },
            {
                $inc: { balance: -levelConfig.cost },
                $set: {
                    level: level,
                    features_unlocked
                },
                $push: {
                    purchased_levels: level,
                    level_purchase_history: {
                        level,
                        cost: levelConfig.cost,
                        purchased_at: new Date()
                    },
                    history: {
                        title: `Level ${level} Purchase: ${levelConfig.name}`,
                        reward: -levelConfig.cost,
                        taskId: `level_${level}`,
                        date: new Date()
                    }
                }
            },
            { new: true }
        );

        // 8. Log admin action
        await logAdminAction(
            { id: 0, first_name: 'System' },
            'level_purchased',
            `User ${userId} purchased Level ${level} for ${levelConfig.cost} DASH`
        );

        // 9. Send Telegram notification
        try {
            await bot.telegram.sendMessage(
                userId,
                `🎉 *Congratulations!*\n\nYou've unlocked *Level ${level}: ${levelConfig.name}*\n\nNew features unlocked:\n${levelConfig.features.map(f => `• ${f}`).join('\n')}`,
                { parse_mode: 'Markdown' }
            );
        } catch (botErr) {
            console.error('Bot notification error:', botErr.message);
        }

        return res.json({
            success: true,
            message: `Level ${level} purchased successfully`,
            newLevel: level,
            newBalance: updatedUser.balance,
            unlockedFeatures: levelConfig.features
        });

    } catch (err) {
        console.error('Level purchase error:', err);
        res.status(500).json({ error: 'Failed to purchase level' });
    }
});


// CHECK if user can access a specific feature
router.get('/api/secure/feature/check', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { feature } = req.query;

        if (!feature) {
            return res.status(400).json({ error: 'feature parameter required' });
        }

        const user = await User.findOne({ user_id: userId })
            .select('level features_unlocked');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const hasFeature = user.features_unlocked?.[feature] || false;

        // If feature not unlocked, find what level it unlocks at
        let unlocksAtLevel = null;
        if (!hasFeature) {
            const levelWithFeature = await LevelConfig.findOne({
                features: feature
            }).sort({ level: 1 });
            unlocksAtLevel = levelWithFeature?.level || null;
        }

        return res.json({
            success: true,
            feature,
            allowed: hasFeature,
            userLevel: user.level,
            unlocksAtLevel,
            reason: hasFeature
                ? 'Feature unlocked'
                : `Unlock at Level ${unlocksAtLevel}`
        });

    } catch (err) {
        console.error('Feature check error:', err);
        res.status(500).json({ error: 'Failed to check feature' });
    }
});

// =====================================================
// LEVEL SYSTEM ADMIN ROUTES
// =====================================================

// GET all level configurations
router.get('/api/admin/levels/config', validateAdmin, async (req, res) => {
    try {
        const levels = await LevelConfig.find().sort({ level: 1 });
        if (levels.length === 0) {
            // Seed default levels if none exist
            const defaultLevels = [
                { level: 1, name: 'Hustler', cost: 10000, features: ['daily_tasks'], daily_task_limit: 1, daily_task_reward: 500, cost_discount_percent: 100, commission_percent: 5 },
                { level: 2, name: 'Authority', cost: 20000, features: ['daily_tasks'], daily_task_limit: 1, daily_task_reward: 600, cost_discount_percent: 100, commission_percent: 5 },
                { level: 3, name: 'Creator', cost: 30000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks'], daily_task_limit: 1, daily_task_reward: 700, cost_discount_percent: 100, commission_percent: 10 },
                { level: 4, name: 'Content King', cost: 40000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks', 'monthly_tasks'], daily_task_limit: 1, daily_task_reward: 800, cost_discount_percent: 100, commission_percent: 10 },
                { level: 5, name: 'Power User', cost: 50000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks', 'monthly_tasks', 'three_month_tasks', 'whitelist', 'analytics'], daily_task_limit: 1, daily_task_reward: 900, cost_discount_percent: 80, commission_percent: 15 },
                { level: 6, name: 'Master Tactician', cost: 60000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks', 'monthly_tasks', 'three_month_tasks', 'whitelist', 'analytics'], daily_task_limit: 2, daily_task_reward: 1000, cost_discount_percent: 70, commission_percent: 15 },
                { level: 7, name: 'Influencer', cost: 70000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks', 'monthly_tasks', 'three_month_tasks', 'whitelist', 'analytics', 'youtube_tasks'], daily_task_limit: 2, daily_task_reward: 1100, cost_discount_percent: 60, commission_percent: 20 },
                { level: 8, name: 'Empire Builder', cost: 80000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks', 'monthly_tasks', 'three_month_tasks', 'whitelist', 'analytics', 'youtube_tasks'], daily_task_limit: 2, daily_task_reward: 1200, cost_discount_percent: 50, commission_percent: 20 },
                { level: 9, name: 'Legend Candidate', cost: 90000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks', 'monthly_tasks', 'three_month_tasks', 'whitelist', 'analytics', 'youtube_tasks', 'priority_support'], daily_task_limit: 2, daily_task_reward: 1300, cost_discount_percent: 45, commission_percent: 25 },
                { level: 10, name: 'Legend', cost: 100000, features: ['daily_tasks', 'custom_tasks', 'weekly_tasks', 'monthly_tasks', 'three_month_tasks', 'whitelist', 'analytics', 'youtube_tasks', 'priority_support'], daily_task_limit: 2, daily_task_reward: 1400, cost_discount_percent: 40, commission_percent: 25 }
            ];
            await LevelConfig.insertMany(defaultLevels);
            return res.json({ success: true, levels: defaultLevels, seeded: true });
        }
        return res.json({ success: true, levels });
    } catch (err) {
        console.error('Level config error:', err);
        res.status(500).json({ error: 'Failed to fetch level config' });
    }
});


// UPDATE level configuration (admin only)
router.post('/api/admin/levels/update', validateAdmin, async (req, res) => {
    try {
        const { level, name, cost, features, daily_task_limit, daily_task_reward, cost_discount_percent, commission_percent } = req.body;

        if (!level || level < 1 || level > 10) {
            return res.status(400).json({ error: 'Invalid level (1-10)' });
        }

        const updated = await LevelConfig.findOneAndUpdate(
            { level },
            {
                $set: {
                    name,
                    cost,
                    features,
                    daily_task_limit,
                    daily_task_reward,
                    cost_discount_percent,
                    commission_percent
                }
            },
            { new: true, upsert: true }
        );

        await logAdminAction(req.adminUser, 'level_config_updated', `Level ${level} updated`);
        return res.json({ success: true, level: updated });
    } catch (err) {
        console.error('Level update error:', err);
        res.status(500).json({ error: 'Failed to update level' });
    }
});


// SET user level (admin force-set)
router.post('/api/admin/user/set-level', validateAdmin, async (req, res) => {
    try {
        const { target_user_id, level } = req.body;

        if (!target_user_id) return res.status(400).json({ error: 'User ID required' });
        if (level < 0 || level > 10) return res.status(400).json({ error: 'Invalid level' });

        // Get level config
        const levelConfig = level > 0 ? await LevelConfig.findOne({ level }) : null;

        // Build features_unlocked object
        let features_unlocked = {
            daily_tasks: false,
            custom_tasks: false,
            weekly_tasks: false,
            monthly_tasks: false,
            three_month_tasks: false,
            whitelist: false,
            analytics: false,
            youtube_tasks: false,
            priority_support: false
        };

        if (levelConfig && levelConfig.features) {
            levelConfig.features.forEach(feature => {
                if (features_unlocked.hasOwnProperty(feature)) {
                    features_unlocked[feature] = true;
                }
            });
        }

        const updatedUser = await User.findOneAndUpdate(
            { user_id: Number(target_user_id) },
            {
                $set: {
                    level: Number(level),
                    features_unlocked,
                    purchased_levels: level > 0 ? Array.from({length: level}, (_, i) => i + 1) : []
                }
            },
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ error: 'User not found' });

        await logAdminAction(req.adminUser, 'user_level_set', `User ${target_user_id} set to level ${level}`);
        return res.json({ success: true, user: { user_id: updatedUser.user_id, level: updatedUser.level } });
    } catch (err) {
        console.error('Set level error:', err);
        res.status(500).json({ error: 'Failed to set user level' });
    }
});

module.exports = router;
