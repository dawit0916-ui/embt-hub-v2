const express = require('express');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { User } = require('../models');
const { logAdminAction } = require('../utils/logAdminAction');

router.post('/api/admin/broadcast', validateAdmin, async (req, res) => {
    const { message, imageFileId, buttonText, buttonUrl } = req.body;
    if (!message) return res.status(400).json({ error: "Blank body payload allocation" });

    // Telegram's caption limit (for a photo+caption message) is 1024 chars,
    // much shorter than the ~4096 limit for a plain text message.
    const maxLen = imageFileId ? 1024 : 4096;
    if (message.length > maxLen) {
        return res.status(400).json({ error: `Message too long (${message.length}/${maxLen} chars)${imageFileId ? ' — image captions have a shorter limit than text messages' : ''}` });
    }

    const reply_markup = (buttonText && buttonUrl)
        ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] }
        : undefined;

    const users = await User.find({}, 'user_id');
    await logAdminAction(req.adminUser, 'broadcast_sent', `Sent to ${users.length} users${imageFileId ? ' (with image)' : ''}${reply_markup ? ' (with button)' : ''}`);
    res.json({ success: true, total: users.length });

    (async () => {
        for (const user of users) {
            try {
                if (imageFileId) {
                    await bot.telegram.sendPhoto(user.user_id, imageFileId, { caption: message, parse_mode: 'HTML', reply_markup });
                } else {
                    await bot.telegram.sendMessage(user.user_id, message, { parse_mode: 'HTML', reply_markup });
                }
            } catch (err) {}
            await new Promise(resolve => setTimeout(resolve, 75));
        }
    })();
});

module.exports = router;
