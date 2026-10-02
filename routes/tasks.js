const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const crypto = require('crypto');
const { Task, User, ProofSubmission } = require('../models');
const { payReferral } = require('../utils/referral');
const { logAdminAction } = require('../utils/logAdminAction');

function buildTaskFields(b, requireAll) {
    const f = {};
    if (b.title !== undefined) f.title = String(b.title).trim();
    if (b.description !== undefined) f.description = String(b.description).trim();
    if (b.image !== undefined) f.image = String(b.image);
    if (b.category !== undefined) f.category = String(b.category);
    if (b.url !== undefined) f.url = String(b.url).trim();
    if (b.reward !== undefined) f.reward = Number(b.reward);
    if (b.type !== undefined) f.type = b.type;
    if (b.proof_type !== undefined) f.proof_type = b.proof_type;
    if (b.max_users !== undefined) f.max_users = (b.max_users === null || b.max_users === '') ? null : Number(b.max_users);
    if (b.enabled !== undefined) f.enabled = Boolean(b.enabled);

    if (f.type !== undefined && !['auto', 'manual'].includes(f.type)) return { error: 'Task type must be auto or manual.' };
    if (f.proof_type !== undefined && !['text', 'screenshot', 'either'].includes(f.proof_type)) return { error: 'Invalid proof type.' };
    if (f.reward !== undefined && !(f.reward > 0)) return { error: 'Reward must be greater than 0.' };
    if (f.max_users != null && !(Number.isInteger(f.max_users) && f.max_users > 0)) return { error: 'Max completions must be a whole number above 0.' };
    // Auto tasks are verified through getChatMember, so they need a public t.me link
    if (f.type === 'auto' && f.url !== undefined && !/^https:\/\/t\.me\/[A-Za-z0-9_]{4,}/.test(f.url)) {
        return { error: 'Auto tasks need a public Telegram link like https://t.me/channelname (invite links with + cannot be verified).' };
    }
    if (requireAll && (!f.title || !f.url || f.reward === undefined)) return { error: 'Title, link and reward are required.' };
    return { fields: f };
        }
router.get('/api/admin/tasks', validateAdmin, async (req, res) => res.json(await Task.find()));


// Upgraded task route matching your exact frontend schema payload expectations
router.post('/api/admin/tasks/add', validateAdmin, async (req, res) => {
    try {
        const { fields, error } = buildTaskFields(req.body, true);
        if (error) return res.status(400).json({ success: false, error });

        const taskId = 't' + crypto.randomBytes(4).toString('hex');
        const newTask = await Task.create({ ...fields, id: taskId });

        await logAdminAction(req.adminUser, 'task_added', `Added ${newTask.type} task: ${newTask.title}`);
        return res.json({ success: true, taskId });
    } catch (err) {
        console.error("Task deployment failure:", err);
        return res.status(500).json({ success: false, error: "Failed to save task." });
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

        // 2. Fetch task (auto tasks only — manual tasks are paid on proof approval)
        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: "Task not found." });
        if (task.type !== 'auto') {
            return res.status(400).json({ error: "This task needs proof. Submit it from the task card." });
        }

        // 3. Telegram membership verification (fails closed)
        const match = (task.url || '').match(/t\.me\/([A-Za-z0-9_]{4,})/);
        if (!match) return res.status(400).json({ error: "This task can't be verified automatically." });
        try {
            const member = await bot.telegram.getChatMember('@' + match[1], userId);
            if (!['member', 'administrator', 'creator'].includes(member.status)) {
                return res.status(400).json({ error: "You have not joined the channel yet. Please join first then claim." });
            }
        } catch (verifyErr) {
            console.error("Membership verification error:", verifyErr.message);
            return res.status(400).json({ error: "Could not verify channel membership. Please make sure you've joined and try again." });
        }

        // 3.5 Reserve a slot atomically (respects max_users)
        const slot = await Task.findOneAndUpdate(
            { id: taskId, enabled: true, $or: [{ max_users: null }, { $expr: { $lt: ['$completions', '$max_users'] } }] },
            { $inc: { completions: 1 } }
        );
        if (!slot) return res.status(400).json({ error: "This task is full." });

        // 4. Get settings
        // 4. Pay (guarded so a double-tap can't pay twice)
        const paid = await User.updateOne(
            { user_id: userId, completed_tasks: { $ne: taskId } },
            {
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: {
                    completed_tasks: taskId,
                    history: { title: task.title, reward: task.reward, taskId: taskId, date: new Date() }
                }
            }
        );
        if (paid.modifiedCount === 0) {
            await Task.updateOne({ id: taskId }, { $inc: { completions: -1 } });
            return res.status(400).json({ error: "Task already claimed." });
        }

        // 5. Referral: commission + milestone bonus
        await payReferral(userId, task.reward, { countsAsTask: true });
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

router.put('/api/admin/tasks/update/:id', validateAdmin, async (req, res) => {
    try {
        const { fields, error } = buildTaskFields(req.body, false);
        if (error) return res.status(400).json({ success: false, error });

        const updatedTask = await Task.findOneAndUpdate(
            { id: req.params.id },
            { $set: fields },
            { new: true }
        );
        if (!updatedTask) return res.status(404).json({ error: "Task not found." });

        await logAdminAction(req.adminUser, 'task_updated', `Updated task: ${updatedTask.title}`);
        return res.json({ success: true, task: updatedTask });
    } catch (err) {
        console.error("Update task error:", err);
        return res.status(500).json({ error: "Failed to update task." });
    }
});



router.get('/api/secure/tasks-with-progress', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const user = await User.findOne({ user_id: userId }).select('completed_tasks');
        const done = new Set(user?.completed_tasks || []);

        const pendingDocs = await ProofSubmission.find({ userId, status: 'pending' }).select('taskId').lean();
        const pending = new Set(pendingDocs.map(p => p.taskId));

        const tasks = await Task.find({ enabled: true });
        return res.json({
            success: true,
            tasks: tasks.map(t => ({
                ...t.toObject(),
                completed: done.has(t.id),
                pending: pending.has(t.id),
                full: !!t.max_users && t.completions >= t.max_users
            }))
        });
    } catch (err) {
        console.error("Tasks-with-progress error:", err);
        return res.status(500).json({ error: "Failed to load tasks." });
    }
});

module.exports = router;
