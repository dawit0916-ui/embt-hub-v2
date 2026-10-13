const verifyTelegramInitData = require('./verifyTelegramInitData');
const UserNotifState = require('../models/userNotifState');
const activeTouch = new Map();

const validateInitData = async (req, res, next) => {
    const rawInitData = req.headers['x-telegram-init-data']
        || req.headers['X-Telegram-Init-Data']
        || req.query.initData;
    const user = verifyTelegramInitData(rawInitData);

    if (!user) {
        console.warn(`[Security Alert] Signature verification failed or payload missing.`);
        return res.status(403).json({ error: "Signature hash mismatch or expired session state." });
    }

    req.tgUser = user;
    const uid = Number(req.tgUser.id);
const last = activeTouch.get(uid) || 0;
if (Date.now() - last > 10 * 60 * 1000) {
    activeTouch.set(uid, Date.now());
    UserNotifState.updateOne(
        { user_id: uid },
        { $set: { last_active_at: new Date() } },
        { upsert: true }
    ).catch(() => {});
}
    next();
};

module.exports = validateInitData;
