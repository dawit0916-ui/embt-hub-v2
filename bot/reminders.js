const bot = require('./bot');
const { ReminderConfig, User, UserReminder } = require('../models');

async function getReminderConfig() {
    let config = await ReminderConfig.findOne();
    if (!config) {
        config = await ReminderConfig.create({
            reminder_enabled: true,
            reminder_image_message_id: null,
            reminder_image_file_id: null
        });
    }
    return config;
}

async function sendReminderMessage(userId) {
    try {
        const config = await getReminderConfig();
        if (!config.reminder_enabled || !config.reminder_image_file_id) {
            console.warn(`[Reminder] Config missing for user ${userId}`);
            return false;
        }

        const reminderText = `🔔 *You're Missing Out!*\n\nHey! Get back to earning with Dash Earn. Tap the button below to continue 🚀`;

        const senMsg = await bot.telegram.sendPhoto(
            userId,
            config.reminder_image_file_id,
            {
                caption: reminderText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '▶️ Start Earning',
                            callback_data: 'start_bot_reminder'
                        }
                    ]]
                }
            }
        );

        // ✅ FIXED: Only push senMsg.message_id (no ctx needed)
        await User.updateOne(
            { user_id: userId },
            { $push: { pending_message_cleanup: senMsg.message_id } }
        );

        await UserReminder.updateOne(
            { user_id: userId },
            {
                $set: {
                    last_reminder_sent: new Date(),
                    welcome_message_deleted: false
                },
                $inc: { reminder_count: 1 }
            },
            { upsert: true }
        );

        return true;
    } catch (err) {
        console.error(`[Reminder Send Error] User ${userId}:`, err.message);
        return false;
    }
}

async function checkAndSendReminders() {
    try {
        const now = new Date();
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

        // Find users with deleted welcome messages who haven't gotten a reminder in 6 hours
        const usersNeedingReminder = await UserReminder.find({
            welcome_message_deleted: true,
            $or: [
                { last_reminder_sent: null },
                { last_reminder_sent: { $lt: sixHoursAgo } }
            ]
        });

        console.log(`[Reminder Check] Found ${usersNeedingReminder.length} users needing reminders`);

        for (const reminder of usersNeedingReminder) {
            const sent = await sendReminderMessage(reminder.user_id);
            if (sent) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
            }
        }

    } catch (err) {
        console.error('[Reminder Check Error]:', err.message);
    }
}

// 🔔 Reminder System Workers
setInterval(async () => {
    try {
        console.log("📢 Reminder system check cycle...");
        await checkAndSendReminders();
    } catch (err) {
        console.error('[Reminder Worker Error]:', err.message);
    }
}, 2 * 60 * 60 * 1000); // Every 2 hours


// 🔄 Check for deleted welcome messages
setInterval(async () => {
    try {
        console.log("🔄 [Reminder Check] Checking for deleted welcome messages...");

        // Case 1: users still holding message IDs to check — verify if deleted
        const usersWithPending = await User.find({
            pending_message_cleanup: { $exists: true, $ne: [] },
            is_banned: false
        }).lean();

        for (const user of usersWithPending) {
            for (const msgId of user.pending_message_cleanup) {
                try {
                    await bot.telegram.getMessage(user.user_id, msgId);
                } catch (err) {
                    if (err.message.includes('not found')) {
                        console.log(`[Reminder] Welcome message deleted for user ${user.user_id}`);
                        await UserReminder.updateOne(
                            { user_id: user.user_id },
                            { $set: { welcome_message_deleted: true, deleted_at: new Date(), last_reminder_sent: null } },
                            { upsert: true }
                        );
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // Case 2: cleanup array already empty (cleared by /api/secure/profile)
        // but reminder flag never got flipped — these were falling through before
        const usersAlreadyCleared = await User.find({
            pending_message_cleanup: { $size: 0 },
            is_banned: false
        }).select('user_id').lean();

        const clearedIds = usersAlreadyCleared.map(u => u.user_id);

        if (clearedIds.length > 0) {
            const existingRecords = await UserReminder.find({ user_id: { $in: clearedIds } }).lean();
            const existingMap = new Map(existingRecords.map(r => [r.user_id, r]));

            for (const uid of clearedIds) {
                const rec = existingMap.get(uid);
                if (!rec) {
                    console.log(`[Reminder] Creating record for already-cleared user ${uid}`);
                    await UserReminder.create({
                        user_id: uid,
                        welcome_message_deleted: true,
                        deleted_at: new Date(),
                        last_reminder_sent: null
                    });
                } else if (!rec.welcome_message_deleted) {
                    console.log(`[Reminder] Flagging already-cleared user ${uid} as eligible`);
                    await UserReminder.updateOne(
                        { user_id: uid },
                        { $set: { welcome_message_deleted: true, deleted_at: new Date(), last_reminder_sent: null } }
                    );
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        console.log("[Reminder Check] Deletion check complete");
    } catch (err) {
        console.error('[Welcome Message Checker Error]:', err.message);
    }
}, 30 * 60 * 1000); // Check every 30 minutes

module.exports = { getReminderConfig, sendReminderMessage, checkAndSendReminders };
