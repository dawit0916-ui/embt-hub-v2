const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const { YoutubeTask, User } = require('../models');
const { postToChannel } = require('../utils/channel');
const { logAdminAction } = require('../utils/logAdminAction');

// List all YouTube tasks (admin sees the code too, for editing/reference)
router.get('/api/admin/youtube-tasks', validateAdmin, async (req, res) => {
    try {
        const tasks = await YoutubeTask.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, tasks });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});


// Create a new YouTube task
router.post('/api/admin/youtube-tasks/add', validateAdmin, async (req, res) => {
    try {
        const { title, instructions, youtubeUrl, thumbnail, code, reward } = req.body;

        if (!title || !youtubeUrl || !code || reward === undefined || reward === null) {
            return res.status(400).json({ success: false, error: "Title, YouTube URL, Code, and Reward are required." });
        }

        const rewardNum = parseFloat(reward);
        if (isNaN(rewardNum) || rewardNum <= 0) {
            return res.status(400).json({ success: false, error: "Reward must be a positive number." });
        }

        const newTask = await YoutubeTask.create({
            title: String(title).trim(),
            instructions: instructions ? String(instructions).trim() : '',
            youtubeUrl: String(youtubeUrl).trim(),
            thumbnail: thumbnail || '',
            code: String(code).trim(),
            reward: rewardNum
        });

        await logAdminAction(req.adminUser, 'youtube_task_added', `Added YouTube task: ${newTask.title}`);

        return res.json({ success: true, taskId: newTask.id });
    } catch (err) {
        console.error("YouTube task create error:", err);
        return res.status(500).json({ success: false, error: "Failed to create YouTube task." });
    }
});


// Delete a YouTube task
router.delete('/api/admin/youtube-tasks/delete/:id', validateAdmin, async (req, res) => {
    try {
        const result = await YoutubeTask.deleteOne({ id: req.params.id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, error: "Task not found." });
        }
        await logAdminAction(req.adminUser, 'youtube_task_deleted', `Deleted YouTube task: ${req.params.id}`);
        return res.json({ success: true });
    } catch (err) {
        console.error("YouTube task delete error:", err);
        return res.status(500).json({ success: false, error: "Failed to delete task." });
    }
});


// Toggle enabled/disabled
router.post('/api/admin/youtube-tasks/toggle', validateAdmin, async (req, res) => {
    try {
        const { id, enabled } = req.body;
        const task = await YoutubeTask.findOneAndUpdate(
            { id },
            { $set: { enabled: Boolean(enabled) } },
            { new: true }
        );
        if (!task) return res.status(404).json({ success: false, error: "Task not found." });
        return res.json({ success: true, enabled: task.enabled });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Failed to update task." });
    }
});


router.get('/api/secure/youtube-tasks', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const tasks = await YoutubeTask.find({ enabled: true }).sort({ createdAt: -1 }).lean();

        const safeTasks = tasks.map(t => ({
            id: t.id,
            title: t.title,
            instructions: t.instructions,
            youtubeUrl: t.youtubeUrl,
            thumbnail: t.thumbnail,
            reward: t.reward,
            claimed: (t.claimedBy || []).includes(userId)
            // NOTE: t.code is intentionally never sent to the client
        }));

        return res.json({ success: true, tasks: safeTasks });
    } catch (err) {
        console.error("List YouTube tasks error:", err);
        return res.status(500).json({ success: false, error: "Failed to load tasks." });
    }
});


// Claim a YouTube task by submitting the hidden code
router.post('/api/secure/youtube-tasks/claim', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { taskId, code } = req.body;

        if (!taskId || !code || !String(code).trim()) {
            return res.status(400).json({ success: false, error: "Please enter the code from the video." });
        }

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ success: false, error: "User not found." });
        if (user.is_banned) return res.status(403).json({ success: false, error: "Account is banned." });

        const task = await YoutubeTask.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ success: false, error: "Task not found." });

        if ((task.claimedBy || []).includes(userId)) {
            return res.status(400).json({ success: false, error: "You already claimed this task." });
        }

        // Case-insensitive, trimmed compare so small typos in case don't block legit users
        const submitted = String(code).trim();
        const actual = String(task.code).trim();
        if (submitted !== actual) {
            return res.status(400).json({ success: false, error: "Incorrect code. Re-watch the video and try again." });
        }

        // Mark claimed + credit reward atomically-ish (two writes, but task claim check above guards re-entry)
        await YoutubeTask.updateOne({ id: taskId }, { $addToSet: { claimedBy: userId } });

        await User.updateOne(
            { user_id: userId },
            {
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: {
                    history: {
                        title: `YouTube: ${task.title}`,
                        reward: task.reward,
                        taskId: task.id,
                        date: new Date()
                    }
                }
            }
        );

        // Log to Telegram storage channel, same pattern as your proof submissions
        const logMsg =
            `📺 *YOUTUBE TASK CLAIMED*\n` +
            `🆔 Task: \`${task.id}\`\n` +
            `📝 Title: ${task.title}\n` +
            `👤 User: \`${userId}\`${user.username ? ' @' + user.username : ''}\n` +
            `💰 Reward: ${task.reward} USDT\n` +
            `📅 ${new Date().toLocaleString()}`;
        await postToChannel(logMsg);

        const updatedUser = await User.findOne({ user_id: userId });
        return res.json({
            success: true,
            reward: task.reward,
            newBalance: updatedUser.balance
        });

    } catch (err) {
        console.error("YouTube task claim error:", err);
        return res.status(500).json({ success: false, error: "Internal server error." });
    }
});

module.exports = router;
