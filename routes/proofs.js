const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { Task, User, ProofSubmission } = require('../models');
const { postToChannel, postPhotoToChannel, replyInChannel } = require('../utils/channel');
const { logAdminAction } = require('../utils/logAdminAction');

router.post('/api/secure/submit-proof', validateInitData, async (req, res) => {
    try {
        const { taskId, proof, screenshot } = req.body;
        const userId = req.tgUser.id;

        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: "Task not found." });

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.completed_tasks.includes(taskId)) {
            return res.status(400).json({ error: "Task already submitted." });
        }

        const proofId = 'PRF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const proofType = screenshot ? 'screenshot' : 'text';
        let telegramFileId = null;
        let channelMessageId = null;

        const captionHeader =
            `📋 *PROOF SUBMISSION*\n` +
            `🆔 REF: \`${proofId}\`\n` +
            `👤 User: \`${userId}\`${user.username ? ' @' + user.username : ''}\n` +
            `📝 Task: ${task.title}\n` +
            `💰 Reward: ${task.reward} USDT\n` +
            `📅 ${new Date().toLocaleString()}`;

        if (screenshot) {
            const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const result = await postPhotoToChannel(buffer, captionHeader);
            telegramFileId = result.fileId;
            channelMessageId = result.messageId;
        } else {
            const fullMsg = `${captionHeader}\n\n📄 *Proof:*\n\`\`\`${proof || 'No text'}\`\`\``;
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

        const proof = await ProofSubmission.findOne({ proofId, status: 'pending' });
        if (!proof) return res.status(404).json({ error: 'Proof not found or already reviewed.' });

        if (action === 'approve') {
            await User.updateOne({ user_id: proof.userId }, {
                $inc: { balance: proof.reward, total_earned: proof.reward },
                $push: {
                    completed_tasks: proof.taskId,
                    history: { title: proof.taskTitle, reward: proof.reward, taskId: proof.taskId, date: new Date() }
                }
            });
            try {
                await bot.telegram.sendMessage(proof.userId,
                    `✅ *Proof Approved!*\n\n📋 Task: ${proof.taskTitle}\n💰 +${proof.reward} USDT added\n🆔 REF: \`${proof.proofId}\``,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        } else {
            try {
                await bot.telegram.sendMessage(proof.userId,
                    `❌ *Proof Rejected*\n\n📋 Task: ${proof.taskTitle}\n🆔 REF: \`${proof.proofId}\`\n\nPlease resubmit with a clearer screenshot.`,
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

        await ProofSubmission.updateOne({ proofId }, { $set: { status: action === 'approve' ? 'approved' : 'rejected', reviewedAt: new Date() } });
        await logAdminAction(req.adminUser, action === 'approve' ? 'proof_approved' : 'proof_rejected', `Proof ${proofId} for user ${proof.userId}`);

        res.json({ success: true });
    } catch (e) {
        console.error('Proof action error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
