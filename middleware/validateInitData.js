const verifyTelegramInitData = require('./verifyTelegramInitData');

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
    next();
};

module.exports = validateInitData;
