const express = require('express');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { STORAGE_CHANNEL_ID } = require('../config/constants');
const { ReminderConfig, UserReminder } = require('../models');
const { getReminderConfig } = require('../bot/reminders');
const { logAdminAction } = require('../utils/logAdminAction');

// Upload reminder image to private channel and save file_id
router.post('/api/admin/reminder-config', validateAdmin, async (req, res) => {
    try {
        if (!STORAGE_CHANNEL_ID) {
            return res.status(400).json({ error: "STORAGE_CHANNEL_ID not configured" });
        }

        const caption = `🔔 REMINDER IMAGE - Do not delete`;

        // If body has base64 image
        if (req.body.imageBase64) {
            const base64Data = req.body.imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            const msg = await bot.telegram.sendPhoto(STORAGE_CHANNEL_ID, { source: buffer }, { caption });

            await ReminderConfig.updateOne(
                {},
                {
                    $set: {
                        reminder_image_message_id: msg.message_id,
                        reminder_image_file_id: msg.photo[msg.photo.length - 1].file_id,
                        last_updated: new Date()
                    }
                },
                { upsert: true }
            );

            await logAdminAction(req.adminUser, 'reminder_image_updated', 'Updated reminder image');

            return res.json({
                success: true,
                message: "Reminder image uploaded successfully",
                messageId: msg.message_id,
                fileId: msg.photo[msg.photo.length - 1].file_id
            });
        }

        return res.status(400).json({ error: "No image provided" });

    } catch (err) {
        console.error('[Reminder Config Error]:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});


// Get reminder config status
router.get('/api/admin/reminder-config', validateAdmin, async (req, res) => {
    try {
        const config = await getReminderConfig();
        res.json({
            success: true,
            enabled: config.reminder_enabled,
            has_image: !!config.reminder_image_file_id,
            message_id: config.reminder_image_message_id,
            last_updated: config.last_updated
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// Toggle reminders on/off
router.post('/api/admin/reminder-config/toggle', validateAdmin, async (req, res) => {
    try {
        const { enabled } = req.body;
        await ReminderConfig.updateOne(
            {},
            { $set: { reminder_enabled: Boolean(enabled) } },
            { upsert: true }
        );
        await logAdminAction(req.adminUser, 'reminders_toggled', `Reminders ${enabled ? 'enabled' : 'disabled'}`);
        res.json({ success: true, enabled: Boolean(enabled) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// Get reminder statistics
router.get('/api/admin/reminder-stats', validateAdmin, async (req, res) => {
    try {
        const totalUsersWithDeletedWelcome = await UserReminder.countDocuments({ welcome_message_deleted: true });
        const recentReminders = await UserReminder.find({ last_reminder_sent: { $exists: true, $ne: null } })
            .sort({ last_reminder_sent: -1 })
            .limit(10)
            .lean();

        res.json({
            success: true,
            usersAwaitingReminder: totalUsersWithDeletedWelcome,
            recentReminders: recentReminders.map(r => ({
                user_id: r.user_id,
                last_sent: r.last_reminder_sent,
                count: r.reminder_count
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
