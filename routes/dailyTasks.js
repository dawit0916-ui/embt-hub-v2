const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const taskState = require('../bot/config');
const { User, CompletedTask, PendingReaction, Task, LevelConfig, DailyTaskProgress } = require('../models');
const { getUTCDayStart, getNextResetTime } = require('../utils/time');

// GET /api/secure/daily-tasks/today
// Returns whichever task is active today — comment OR reaction, never both
router.get('/api/secure/daily-tasks/today', validateInitData, async (req, res) => {
  try {
    const userId = req.tgUser.id;
    const user = await User.findOne({ user_id: userId });
    const level = user?.level || 1;
    const reward = 50 * level;

    if (taskState.activeTask.type === 'comment') {
      const todayKey = new Date().toISOString().slice(0, 10);
      const completed = await CompletedTask.findOne({ userId, taskType: 'comment', taskKey: todayKey });
      return res.json({
        success: true,
        task_type: 'comment',
        secret_word: taskState.activeTask.word,
        group_url: process.env.TELEGRAM_GROUP_URL,
        reward,
        completed: !!completed
      });
    }

    if (taskState.activeTask.type === 'reaction') {
      const completed = await CompletedTask.findOne({ userId, taskType: 'reaction', taskKey: String(taskState.activeTask.messageId) });
      return res.json({
        success: true,
        task_type: 'reaction',
        target_emoji: taskState.activeTask.emoji,
        message_id: taskState.activeTask.messageId,
        post_direct_link: `https://t.me/${process.env.TELEGRAM_CHANNEL_NAME}/${taskState.activeTask.messageId}`,
        reward,
        completed: !!completed
      });
    }

    return res.json({ success: false, message: 'No active task configured today' });

  } catch (err) {
    console.error('Error fetching today\'s task:', err);
    res.status(500).json({ success: false, message: 'Failed to load task' });
  }
});

// POST /api/secure/daily-tasks/verify-reaction
router.post('/api/secure/daily-tasks/verify-reaction', validateInitData, async (req, res) => {
  try {
    const userId = req.tgUser.id;

    if (taskState.activeTask.type !== 'reaction') {
      return res.status(400).json({ success: false, message: 'No reaction task active today' });
    }

    const taskKey = String(taskState.activeTask.messageId);
    const requiredEmoji = taskState.activeTask.emoji;

    const alreadyClaimed = await CompletedTask.findOne({ userId, taskType: 'reaction', taskKey });
    if (alreadyClaimed) {
      return res.status(400).json({ success: false, message: 'Already claimed' });
    }

    const reactionFound = await PendingReaction.findOne({ userId, messageId: taskKey });
    if (!reactionFound) {
      return res.status(400).json({
        success: false,
        message: 'No reaction detected yet. Please react to the post first and try again!'
      });
    }

    if (reactionFound.emoji !== requiredEmoji) {
      return res.status(400).json({
        success: false,
        message: `You reacted with ${reactionFound.emoji}, but the task requires ${requiredEmoji}!`
      });
    }

    const user = await User.findOne({ user_id: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const level = user.level || 1;
    const reward = 50 * level;

    await CompletedTask.create({ userId, taskType: 'reaction', taskKey });

    user.balance += reward;
    user.total_earned = (user.total_earned || 0) + reward;
    await user.save();

    await PendingReaction.deleteOne({ userId, messageId: taskKey });

    res.json({
      success: true,
      reward_added: reward,
      new_balance: user.balance
    });

  } catch (err) {
    console.error('Error verifying reaction:', err);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

router.post('/api/secure/daily-tasks/mark-pending-reaction', validateInitData, async (req, res) => {
  try {
    const userId = req.tgUser.id;

    if (taskState.activeTask.type !== 'reaction') {
      return res.status(400).json({ success: false, message: 'No reaction task active today' });
    }

    const taskKey = String(taskState.activeTask.messageId);

    const alreadyClaimed = await CompletedTask.findOne({ userId, taskType: 'reaction', taskKey });
    if (alreadyClaimed) {
      return res.json({ success: true }); // already done, nothing to do
    }

    // Respond right away — don't make the button/link wait
    res.json({ success: true });

    // Write the pending record 5 seconds later, in the background
    setTimeout(async () => {
      try {
        await PendingReaction.findOneAndUpdate(
          { userId, messageId: taskKey },
          { userId, messageId: taskKey, emoji: taskState.activeTask.emoji, createdAt: new Date() },
          { upsert: true, new: true }
        );
      } catch (err) {
        console.error('Delayed pending reaction write error:', err);
      }
    }, 5000);

  } catch (err) {
    console.error('Mark pending reaction error:', err);
    res.status(500).json({ success: false });
  }
});


// Complete a daily task
router.post('/api/secure/complete-daily-task', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { taskId } = req.body;

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(401).json({ error: 'User not found' });

        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // Fetch level config ONCE at the top
        const levelConfig = await LevelConfig.findOne({ level: user.level || 0 });

        // 1.5 CHECK daily task feature + level limit
        if (!user.features_unlocked?.daily_tasks) {
            return res.status(403).json({
                error: 'Daily tasks unlock at Level 2',
                unlocksAtLevel: 2
            });
        }

        const dailyLimit = levelConfig?.daily_task_limit || 1;

        // Count completed daily tasks TODAY
        const dayStart = getUTCDayStart();
        const completedToday = await DailyTaskProgress.countDocuments({
            userId,
            claimedToday: true,
            lastCompletedAt: { $gte: dayStart }
        });

        if (completedToday >= dailyLimit) {
            return res.status(400).json({
                error: `Daily limit reached (${dailyLimit}/${dailyLimit})`,
                completedToday,
                dailyLimit
            });
        }

        let progress = await DailyTaskProgress.findOne({ userId, taskId });
        if (!progress) {
            progress = await DailyTaskProgress.create({
                userId,
                taskId,
                resetAt: getNextResetTime('daily')
            });
        }

        // Check if reset needed
        if (new Date() >= progress.resetAt) {
            progress.completedCount = 0;
            progress.claimedToday = false;
            progress.resetAt = getNextResetTime('daily');
        }

        if (progress.claimedToday) {
            return res.status(400).json({ error: 'Already completed today' });
        }

        // Complete and claim reward
        progress.completedCount = 1;
        progress.claimedToday = true;
        progress.lastCompletedAt = new Date();
        await progress.save();

        // Use the levelConfig already fetched above
        const dailyTaskReward = levelConfig?.daily_task_reward || 500;

        // Apply multiplier (ad-based, not level-based)
        const multiplier = req.body.multiplier || 1.0;
        const finalReward = Math.floor(dailyTaskReward * multiplier);

        // Award user
        await User.updateOne(
            { user_id: userId },
            {
                $inc: { balance: finalReward, total_earned: finalReward },
                $push: {
                    history: {
                        title: `Daily Task: ${task.title}`,
                        reward: finalReward,
                        taskId: `daily_${taskId}`,
                        date: new Date()
                    }
                }
            }
        );

        const updatedUser = await User.findOne({ user_id: userId });
        return res.json({
            success: true,
            reward: finalReward,
            newBalance: updatedUser.balance
        });
    } catch (err) {
        console.error('Complete daily task error:', err);
        res.status(500).json({ error: 'Failed to complete task' });
    }
});

module.exports = router;
