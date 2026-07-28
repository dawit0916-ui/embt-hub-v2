const verifyTelegramInitData = require('./verifyTelegramInitData');
const { admins } = require('../config/constants');
const { User } = require('../models');

const validateAdmin = async (req, res, next) => {
    const rawInitData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
    const user = verifyTelegramInitData(rawInitData);

    if (!user) {
        return res.status(403).json({ error: "Signature hash mismatch or expired session state." });
    }
    if (!admins.includes(user.id)) {
        return res.status(403).json({ error: "Access Denied: Admin Only" });
    }

    req.adminUser = user;
    req.tgUser = user;
    User.updateOne({ user_id: user.id }, { $set: { last_admin_active: new Date() } }).catch(() => {});
    next();
};

module.exports = validateAdmin;
