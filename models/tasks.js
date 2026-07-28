const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { Task, User, LevelConfig, ReferralEarning, DailyTaskProgress } = require('../models');
const { getSettings } = require('../utils/settings');
const { logAdminAction } = require('../utils/logAdminAction');
const { getNextResetTime } = require('../utils/time');

router.get('/api/admin/tasks', validateAdmin, async (req, res) => res.json(await Task.find()));


// Upgraded task route matching your exact frontend schema payload expectations
router.post('/api/admin/tasks/add', validateAdmin, async (req, res) => {
    try {
        const taskId = 't' + Math.floor(Math.random() * 10000);

        // Maps your frontend data schema properties natively into MongoDB
        const newTask = new Task({
            ...req.body,
            id: taskId
        });

        await newTask.save();
        await logAdminAction(req.adminUser, 'task_added', `Added task: ${newTask.title}`);
        return res.json({
            success: true,
            message: "Task successfully saved to database.",
            taskId
        });

    } catch (err) {
        console.error("Task deployment transaction failure:", err);
        return res.status(500).json({
            success: false,
            error: "Database failed to compile or save task properties payload."
        });
    }
});


router.get('/api/secure/available-tasks', validateInitData, async (req, res) => {
    try {
        // 1. Resolve user profile structure from database safely
        const user = await User.findOne({ user_id: req.tgUser.id });

        // 🚨 FIX: Guard against null records to block un-provisioned database views
        if (!user) {
            return res.status(404).json({ error: "User profile context un-synchronized or missing." });
        }

        // 2. Fetch only tasks the authenticated user hasn't finished yet
        const tasks = await Task.find({
            id: { $nin: user.completed_tasks || [] },
            enabled: true
        });

        return res.json(tasks);

    } catch (err) {
        console.error("Secure task matrix pipeline error:", err);
        return res.status(500).json({ error: "Internal Security Pipeline Fault" });
    }
});

router.post('/api/secure/claim-task', validateInitData, async (req, res) => {
    try {
        const { taskId } = req.body;
        const userId = req.tgUser.id;

        // 1. Fetch user
        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.is_banned) return res.status(403).json({ error: "Account is banned." });
        if (user.completed_tasks.includes(taskId)) {
            return res.status(400).json({ error: "Task already claimed." });
        }

        // 2. Fetch task
        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: "Task not found." });
        // 2.5 ADD LEVEL CHECK FOR CUSTOM TASKS
if (task.type === 'custom') {
    if (!user.features_unlocked?.custom_tasks) {
        const levelConfig = await LevelConfig.findOne({ features: 'custom_tasks' });
        return res.status(403).json({
            error: `Custom tasks unlock at Level ${levelConfig.level}`,
            unlocksAtLevel: levelConfig.level
        });
    }
}

// 2.6 ADD LEVEL CHECK FOR TASK DURATION
const DURATION_LEVEL_REQUIREMENT = {
    'weekly': 3,
    'monthly': 4,
    'three_month': 5
};

if (task.duration && DURATION_LEVEL_REQUIREMENT[task.duration]) {
    const requiredLevel = DURATION_LEVEL_REQUIREMENT[task.duration];
    if ((user.level || 0) < requiredLevel) {
        return res.status(403).json({
            error: `${task.duration} duration tasks unlock at Level ${requiredLevel}`,
            unlocksAtLevel: requiredLevel
        });
    }
}
        // 3. ✅ TELEGRAM MEMBERSHIP VERIFICATION
        if (task.type === 'auto' && task.url && task.url.includes('t.me/')) {
    try {
        const urlParts = task.url.split('t.me/')[1];
        const channelUsername = urlParts.split('/')[0];

        if (!channelUsername.startsWith('+')) {
            const channelId = '@' + channelUsername;
            const member = await bot.telegram.getChatMember(channelId, userId);
            const validStatuses = ['member', 'administrator', 'creator'];
            if (!validStatuses.includes(member.status)) {
                return res.status(400).json({
                    error: "You have not joined the channel yet. Please join first then claim."
                });
            }
        }
    } catch (verifyErr) {
        console.error("Membership verification error:", verifyErr.message);
        // FAIL CLOSED — block the claim instead of letting it through
        return res.status(400).json({
            error: "Could not verify channel membership. Please make sure you've joined and try again."
        });
    }
            }
        // 4. Get settings
        const settings = await getSettings();

        // 5. Update user balance and history
        const currentTasksDone = (user.referral_tasks_done || 0) + 1;

        await User.updateOne(
            { user_id: userId },
            {
                $inc: {
                    balance: task.reward,
                    referral_tasks_done: 1,
                    total_earned: task.reward
                },
                $push: {
                    completed_tasks: taskId,
                    history: {
                        title: task.title,
                        reward: task.reward,
                        taskId: taskId,
                        date: new Date()
                    }
                }
            }
        );

        // 6. Referral commission
        if (user.referred_by) {
    const commission = task.reward * ((settings.ref_commission_percent || 10) / 100);
    await User.updateOne({ user_id: user.referred_by }, { $inc: { balance: commission } });
    await ReferralEarning.updateOne(
        { referrerId: user.referred_by, friendId: userId },
        { $inc: { totalEarned: commission }, $set: { lastEarnedAt: new Date() } },
        { upsert: true }
    );
}

        // 7. Referral milestone bonus
        if (user.referred_by && !user.referral_paid && currentTasksDone >= 3) {
            const updateReferrer = await User.updateOne(
                { user_id: userId, referral_paid: { $ne: true } },
                { $set: { referral_paid: true } }
            );
            if (updateReferrer.modifiedCount > 0) {
                await User.updateOne(
                    { user_id: user.referred_by },
                    { $inc: { balance: settings.ref_bonus_amount } }
                );
                try {
                    await bot.telegram.sendMessage(
                        user.referred_by,
                        `🎊 *Invite Bonus:* Your friend completed 3 tasks! You earned ${settings.ref_bonus_amount} DASH.\n Also your Commission Unlocked with this friend. \n you Earn percent set from this user earnings now.`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (botErr) {
                    console.error("Bot notification error:", botErr.message);
                }
            }
        }

        // 8. Return updated balance
        const updatedUser = await User.findOne({ user_id: userId });
        return res.json({
            success: true,
            reward: task.reward,
            newBalance: updatedUser.balance
        });

    } catch (err) {
        console.error("Claim task error:", err);
        return res.status(500).json({ error: "Internal server error." });
    }
});


// 3. Delete task
router.delete('/api/admin/tasks/delete/:id', validateAdmin, async (req, res) => {
    try {
        const taskId = req.params.id;
        const result = await Task.deleteOne({ id: taskId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Task not found." });
        }
        await logAdminAction(req.adminUser, 'task_deleted', `Deleted task: ${taskId}`);
        return res.json({ success: true });

    } catch (err) {
        console.error("Delete task error:", err);
        return res.status(500).json({ error: "Failed to delete task." });
    }
});


// ==========================================================================
// DAILY RESET TASKS ENDPOINTS
// ==========================================================================


// Get all tasks with daily progress
router.get('/api/secure/tasks-with-progress', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;

        const allTasks = await Task.find({ enabled: true });

        const tasksWithProgress = await Promise.all(
            allTasks.map(async (task) => {
                if (task.type !== 'daily') {
                    // One-time tasks
                    const user = await User.findOne({ user_id: userId });
                    const completed = user?.completed_tasks?.includes(task.id);
                    return {
                        ...task.toObject(),
                        completed: !!completed,
                        progress: completed ? 1 : 0,
                        requirementCount: 1
                    };
                }

                // Daily tasks - check if reset needed
                let progress = await DailyTaskProgress.findOne({ userId, taskId: task.id });

                if (!progress) {
                    progress = await DailyTaskProgress.create({
                        userId,
                        taskId: task.id,
                        resetAt: getNextResetTime('daily')
                    });
                }

                const now = new Date();
                if (now >= progress.resetAt) {
                    // Reset this task
                    progress.completedCount = 0;
                    progress.claimedToday = false;
                    progress.resetAt = getNextResetTime('daily');
                    await progress.save();
                }

                return {
                    ...task.toObject(),
                    completed: progress.claimedToday,
                    progress: Math.min(progress.completedCount, 1),
                    requirementCount: 1,
                    resetAt: progress.resetAt
                };
            })
        );

        return res.json({ success: true, tasks: tasksWithProgress });
    } catch (err) {
        console.error('Get tasks error:', err);
        res.status(500).json({ error: 'Failed to load tasks' });
    }
});

module.exports = router;
