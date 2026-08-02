const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const taskState = require('../bot/config');
const { User, CompletedTask, PendingReaction, Task, LevelConfig, DailyTaskProgress } = require('../models');
const { getUTCDayStart, getNextResetTime } = require('../utils/time');

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

// How many Secret Word / Emoji Reaction tasks this user has already
// completed today, and which specific taskKeys — dailyLimit is shared
// across both task types combined, not tracked separately per type.
async function getTodayCompletion(userId) {
    const dateKey = todayKey();
    const completedDocs = await CompletedTask.find({ userId, dateKey });
    return {
        dateKey,
        completedCount: completedDocs.length,
        completedKeys: completedDocs.map(d => d.taskKey)
    };
}

// GET /api/secure/daily-tasks/today
// Randomly serves one not-yet-completed task from today's pool, up to the
// user's level daily_task_limit. Calling this again after completing one
// task correctly serves the next one (if the limit isn't reached yet).
router.get('/api/secure/daily-tasks/today', validateInitData, async (req, res) => {
  try {
    const userId = req.tgUser.id;
    const user = await User.findOne({ user_id: userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const level = user.level || 0;
    const levelConfig = level > 0 ? await LevelConfig.findOne({ level }) : null;
    const dailyLimit = levelConfig?.daily_task_limit || 1;
    const reward = levelConfig?.daily_task_reward || 500;

    const { completedCount, completedKeys } = await getTodayCompletion(userId);

    if (completedCount >= dailyLimit) {
      return res.json({
        success: false,
        message: `Daily limit reached (${completedCount}/${dailyLimit})`,
        completedToday: completedCount,
        dailyLimit
      });
    }

    const pool = taskState.tasks.filter(t => !completedKeys.includes(t.taskKey));
    if (pool.length === 0) {
      return res.json({ success: false, message: 'No tasks left for you today — check back tomorrow!' });
    }

    // Random, not-yet-done task from the pool
    const task = pool[Math.floor(Math.random() * pool.length)];

    if (task.type === 'comment') {
      return res.json({
        success: true,
        task_key: task.taskKey,
        task_type: 'comment',
        secret_word: task.word,
        group_url: process.env.TELEGRAM_GROUP_URL,
        reward,
        completedToday: completedCount,
        dailyLimit
      });
    }

    return res.json({
      success: true,
      task_key: task.taskKey,
      task_type: 'reaction',
      target_emoji: task.emoji,
      message_id: task.messageId,
      post_direct_link: `https://t.me/${process.env.TELEGRAM_CHANNEL_NAME}/${task.messageId}`,
      reward,
      completedToday: completedCount,
      dailyLimit
    });

  } catch (err) {
    console.error('Error fetching today\'s task:', err);
    res.status(500).json({ success: false, message: 'Failed to load task' });
  }
});

// POST /api/secure/daily-tasks/verify-reaction
// Body: { taskKey } — needed now since multiple reaction tasks can be
// active in the same pool.
router.post('/api/secure/daily-tasks/verify-reaction', validateInitData, async (req, res) => {
  try {
    const userId = req.tgUser.id;
    const { taskKey } = req.body;

    const task = taskState.tasks.find(t => t.taskKey === taskKey && t.type === 'reaction');
    if (!task) {
      return res.status(400).json({ success: false, message: 'That reaction task is no longer active' });
    }

    const user = await User.findOne({ user_id: userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const level = user.level || 0;
    const levelConfig = level > 0 ? await LevelConfig.findOne({ level }) : null;
    const dailyLimit = levelConfig?.daily_task_limit || 1;
    const reward = levelConfig?.daily_task_reward || 500;

    const { dateKey, completedCount, completedKeys } = await getTodayCompletion(userId);

    if (completedKeys.includes(taskKey)) {
      return res.status(400).json({ success: false, message: 'Already claimed' });
    }
    if (completedCount >= dailyLimit) {
      return res.status(400).json({ success: false, message: `Daily limit reached (${completedCount}/${dailyLimit})` });
    }

    const messageIdStr = String(task.messageId);
    const reactionFound = await PendingReaction.findOne({ userId, messageId: messageIdStr });
    if (!reactionFound) {
      return res.status(400).json({
        success: false,
        message: 'No reaction detected yet. Please react to the post first and try again!'
      });
    }

    if (reactionFound.emoji !== task.emoji) {
      return res.status(400).json({
        success: false,
        message: `You reacted with ${reactionFound.emoji}, but the task requires ${task.emoji}!`
      });
    }

    await CompletedTask.create({ userId, taskType: 'reaction', taskKey, dateKey });

    user.balance += reward;
    user.total_earned = (user.total_earned || 0) + reward;
    await user.save();

    await PendingReaction.deleteOne({ userId, messageId: messageIdStr });

    res.json({
      success: true,
      reward_added: reward,
      new_balance: user.balance,
      completedToday: completedCount + 1,
      dailyLimit
    });

  } catch (err) {
    console.error('Error verifying reaction:', err);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// POST /api/secure/daily-tasks/mark-pending-reaction
// Body: { taskKey }
router.post('/api/secure/daily-tasks/mark-pending-reaction', validateInitData, async (req, res) => {
  try {
    const userId = req.tgUser.id;
    const { taskKey } = req.body;

    const task = taskState.tasks.find(t => t.taskKey === taskKey && t.type === 'reaction');
    if (!task) {
      return res.status(400).json({ success: false, message: 'That reaction task is no longer active' });
    }

    const { dateKey, completedKeys } = await getTodayCompletion(userId);
    if (completedKeys.includes(taskKey)) {
      return res.json({ success: true }); // already done, nothing to do
    }

    const messageIdStr = String(task.messageId);

    // Respond right away — don't make the button/link wait
    res.json({ success: true });

    // Write the pending record 5 seconds later, in the background
    setTimeout(async () => {
      try {
        await PendingReaction.findOneAndUpdate(
          { userId, messageId: messageIdStr },
          { userId, messageId: messageIdStr, emoji: task.emoji, createdAt: new Date() },
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


// ==========================================================================
// SUPERSEDED — this route used the old single-task DailyTaskProgress system
// for admin-created Task documents with type:'daily'. It was never actually
// called from the frontend (confirmed by searching every JS file), and the
// Secret Word / Emoji Reaction pool above now covers the "daily task" use
// case with real level-gating and rewards. Commented out rather than
// deleted, in case DailyTaskProgress-based tasks come back later.
// ==========================================================================
/*
router.post('/api/secure/complete-daily-task', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { taskId } = req.body;

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(401).json({ error: 'User not found' });

        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const levelConfig = await LevelConfig.findOne({ level: user.level || 0 });

        if (!user.features_unlocked?.daily_tasks) {
            return res.status(403).json({
                error: 'Daily tasks unlock at Level 2',
                unlocksAtLevel: 2
            });
        }

        const dailyLimit = levelConfig?.daily_task_limit || 1;

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

        if (new Date() >= progress.resetAt) {
            progress.completedCount = 0;
            progress.claimedToday = false;
            progress.resetAt = getNextResetTime('daily');
        }

        if (progress.claimedToday) {
            return res.status(400).json({ error: 'Already completed today' });
        }

        progress.completedCount = 1;
        progress.claimedToday = true;
        progress.lastCompletedAt = new Date();
        await progress.save();

        const dailyTaskReward = levelConfig?.daily_task_reward || 500;
        const multiplier = req.body.multiplier || 1.0;
        const finalReward = Math.floor(dailyTaskReward * multiplier);

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
*/

module.exports = router;
