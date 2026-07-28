const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { STORAGE_CHANNEL_ID } = require('../config/constants');
const { User, Ticket } = require('../models');
const { postToChannel, replyInChannel } = require('../utils/channel');
const { logAdminAction } = require('../utils/logAdminAction');

router.post('/api/support/create', validateInitData, async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.tgUser?.id;
        const user = await User.findOne({ user_id: userId });

        const ticket = await Ticket.create({
            user_id: userId,
            username: user?.username || null,
            message
        });

        const msg =
            `🎧 *SUPPORT TICKET*\n` +
            `🆔 REF: \`${ticket.ticket_id}\`\n` +
            `👤 User: \`${userId}\`${user?.username ? ' @' + user.username : ''}\n` +
            `📅 ${new Date().toLocaleString()}\n\n` +
            `💬 *Message:*\n${message}`;

        const channelMsgId = await postToChannel(msg);
        if (channelMsgId) {
            await Ticket.updateOne({ _id: ticket._id }, { $set: { channel_message_id: channelMsgId } });
        }

        res.json({ success: true, ticketId: ticket.ticket_id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/admin/reply-ticket', validateAdmin, async (req, res) => {
    try {
        const ticket = await Ticket.findByIdAndUpdate(
            req.body.ticketId,
            { admin_reply: req.body.reply, status: 'replied' },
            { new: false } // get original to read channel_message_id
        );

        try {
            await bot.telegram.sendMessage(ticket.user_id,
                `📩 *Support Reply*\n\n${req.body.reply}`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {}

        if (ticket.channel_message_id) {
            const adminName = req.adminUser.first_name || req.adminUser.username || 'Admin';
            await replyInChannel(ticket.channel_message_id,
                `📩 *ADMIN REPLY* by ${adminName}\n\n${req.body.reply}\n\n🕐 ${new Date().toLocaleString()}`
            );
        }

        await logAdminAction(req.adminUser, 'ticket_replied', `Replied to ticket ${ticket.ticket_id || ticket._id}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/admin/tickets/resolve', validateAdmin, async (req, res) => {
    try {
        const { ticketId } = req.body;
        const ticket = await Ticket.findByIdAndUpdate(
            ticketId,
            { status: 'resolved' },
            { new: false }
        );

        if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

        try {
            await bot.telegram.sendMessage(ticket.user_id,
                `🎫 *Support Ticket Resolved*\n\nYour ticket \`${ticket.ticket_id || ticket._id}\` has been marked as resolved.\n\nIf you need further help, feel free to submit a new ticket.`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {}

        if (ticket.channel_message_id && STORAGE_CHANNEL_ID) {
            const adminName = req.adminUser.first_name || req.adminUser.username || 'Admin';
            await replyInChannel(ticket.channel_message_id,
                `✅ *RESOLVED* by ${adminName}\n🕐 ${new Date().toLocaleString()}`
            );
        }

        await logAdminAction(req.adminUser, 'ticket_resolved', `Resolved ticket ${ticket.ticket_id || ticket._id} for user ${ticket.user_id}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/admin/tickets', validateAdmin, async (req, res) => {
    try {
        const filter = req.query.filter || 'open';

        let query = {};
        if (filter === 'open') query.status = 'open';
        else if (filter === 'replied') query.status = 'replied';
        else if (filter === 'resolved') query.status = 'resolved';
        // 'all' returns everything

        const tickets = await Ticket.find(query).sort({ created_at: -1 }).lean();

        // Count all statuses for badges
        const [openCount, repliedCount, resolvedCount] = await Promise.all([
            Ticket.countDocuments({ status: 'open' }),
            Ticket.countDocuments({ status: 'replied' }),
            Ticket.countDocuments({ status: 'resolved' })
        ]);

        res.json({
            success: true,
            tickets,
            counts: { open: openCount, replied: repliedCount, resolved: resolvedCount }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
