const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { Task, User, ProofSubmission } = require('../models');
const { payReferral } = require('../utils/referral');
const { postToChannel, postPhotoToChannel, replyInChannel } = require('../utils/channel');
const { logAdminAction } = require('../utils/logAdminAction');
const { runGhostValidator } = require('../bot/ghostValidator');

// This has been called by the admin panel's "Run Global Sweep" button since
// the original monolithic file, but the route itself never existed —
// runGhostValidator only ever ran via a 24-hour setInterval. Wiring it up
// so the button actually does something on demand.
router.post('/api/admin/run-sweep', validateAdmin, async (req, res) => {
    try {
        const result = await runGhostValidator(null);
        await logAdminAction(req.adminUser, 'manual_sweep', `Manual sweep run — ${result.caughtCount} flagged`);
        res.json({ success: true, flagged: result.caughtCount });
    } catch (err) {
        console.error('Manual sweep error:', err);
        res.status(500).json({ error: 'Sweep failed to run' });
    }
});

router.post('/api/secure/submit-proof', validateInitData, async (req, res) => {
    try {
        const { taskId, proof, screenshot } = req.body;
        const userId = req.tgUser.id;

        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: "Task not found." });
        if (task.type !== 'manual') return res.status(400).json({ error: "This task doesn't take proof." });
        if (task.max_users && task.completions >= task.max_users) return res.status(400).json({ error: "This task is full." });

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.is_banned) return res.status(403).json({ error: "Account is banned." });
        if (user.completed_tasks.includes(taskId)) return res.status(400).json({ error: "Task already completed." });

        if (await ProofSubmission.exists({ userId, taskId, status: 'pending' })) {
            return res.status(400).json({ error: "You already have a proof waiting for review." });
        }

        const text = typeof proof === 'string' ? proof.trim().slice(0, 1000) : '';
        const hasShot = typeof screenshot === 'string' && screenshot.startsWith('data:image/');
        if (!text && !hasShot) return res.status(400).json({ error: "Add your proof first." });
        if (task.proof_type === 'text' && !text) return res.status(400).json({ error: "This task needs a text proof." });
        if (task.proof_type === 'screenshot' && !hasShot) return res.status(400).json({ error: "This task needs a screenshot." });

        const proofId = 'PRF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const proofType = hasShot ? 'screenshot' : 'text';
        let telegramFileId = null;
        let channelMessageId = null;

        const captionHeader =
            `📋 *PROOF SUBMISSION*\n` +
            `🆔 REF: \`${proofId}\`\n` +
            `👤 User: \`${userId}\`${user.username ? ' @' + user.username : ''}\n` +
            `📝 Task: ${task.title}\n` +
            `💰 Reward: ${task.reward} DASH\n` +
            `📅 ${new Date().toLocaleString()}`;

        if (hasShot) {
            const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const result = await postPhotoToChannel(buffer, captionHeader);
            telegramFileId = result.fileId;
            channelMessageId = result.messageId;
        } else {
            const fullMsg = `${captionHeader}\n\n📄 *Proof:*\n\`\`\`${text || 'No text'}\`\`\``;
            channelMessageId = await postToChannel(fullMsg);
        }

        await ProofSubmission.create({
            proofId,
            userId,
            username: user.username || null,
            taskId,
            taskTitle: task.title,
            reward: task.reward,
            proofType,
            proofText: proof || null,
            telegramFileId,
            channelMessageId
        });

        return res.json({ success: true, proofId });

    } catch (err) {
        console.error("Submit proof error:", err);
        return res.status(500).json({ error: "Failed to submit proof." });
    }
});

// Get pending proofs
router.get('/api/admin/proofs/pending', validateAdmin, async (req, res) => {
    try {
        const proofs = await ProofSubmission.find({ status: 'pending' })
            .sort({ submittedAt: -1 }).lean();
        res.json({ success: true, proofs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Get screenshot URL for a proof
router.get('/api/admin/proof-image/:proofId', validateAdmin, async (req, res) => {
    try {
        const proof = await ProofSubmission.findOne({ proofId: req.params.proofId });
        if (!proof?.telegramFileId) return res.status(404).json({ error: 'No screenshot.' });
        const file = await bot.telegram.getFile(proof.telegramFileId);
        res.json({ url: `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Approve or reject a proof
router.post('/api/admin/proof-action', validateAdmin, async (req, res) => {
    try {
        const { proofId, action } = req.body;
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action.' });
        }

        // Claim the review atomically: a second tap finds nothing pending, so it can't pay twice
        const proof = await ProofSubmission.findOneAndUpdate(
            { proofId, status: 'pending' },
            { $set: { status: action === 'approve' ? 'approved' : 'rejected', reviewedAt: new Date() } }
        );
        if (!proof) return res.status(404).json({ error: 'Proof not found or already reviewed.' });

        if (action === 'approve') {
            // Reserve a slot (respects max_users). A deleted task needs no slot.
            const slot = await Task.findOneAndUpdate(
                { id: proof.taskId, $or: [{ max_users: null }, { $expr: { $lt: ['$completions', '$max_users'] } }] },
                { $inc: { completions: 1 } }
            );
            if (!slot && await Task.exists({ id: proof.taskId })) {
                await ProofSubmission.updateOne({ proofId }, { $set: { status: 'pending', reviewedAt: null } });
                return res.status(400).json({ error: 'Task is full. Reject this proof instead.' });
            }

            const paid = await User.updateOne(
                { user_id: proof.userId, completed_tasks: { $ne: proof.taskId } },
                {
                    $inc: { balance: proof.reward, total_earned: proof.reward },
                    $push: {
                        completed_tasks: proof.taskId,
                        history: { title: proof.taskTitle, reward: proof.reward, taskId: proof.taskId, date: new Date() }
                    }
                }
            );
            if (paid.modifiedCount === 0) {
                if (slot) await Task.updateOne({ id: proof.taskId }, { $inc: { completions: -1 } });
                await ProofSubmission.updateOne({ proofId }, { $set: { status: 'rejected' } });
                return res.status(400).json({ error: 'User already completed this task. Proof closed.' });
            }

            await payReferral(proof.userId, proof.reward, { countsAsTask: true });

            try {
                await bot.telegram.sendMessage(proof.userId,
                    `✅ *Proof Approved!*\n\n📋 Task: ${proof.taskTitle}\n💰 +${proof.reward} DASH added\n🆔 REF: \`${proof.proofId}\``,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        } else {
            try {
                await bot.telegram.sendMessage(proof.userId,
                    `❌ *Proof Rejected*\n\n📋 Task: ${proof.taskTitle}\n🆔 REF: \`${proof.proofId}\`\n\nPlease resubmit with a clearer proof.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        }

        if (proof.channelMessageId) {
            const adminName = req.adminUser.first_name || req.adminUser.username || 'Admin';
            await replyInChannel(proof.channelMessageId,
                `${action === 'approve' ? '✅ APPROVED' : '❌ REJECTED'} by ${adminName}\n🕐 ${new Date().toLocaleString()}`
            );
        }

        await logAdminAction(req.adminUser, action === 'approve' ? 'proof_approved' : 'proof_rejected', `Proof ${proofId} for user ${proof.userId}`);
        res.json({ success: true });
    } catch (e) {
        console.error('Proof action error:', e);
        res.status(500).json({ error: e.message });
    }
});
});

module.exports = router;
