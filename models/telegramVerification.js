const mongoose = require('mongoose');

const TelegramVerification = mongoose.model('TelegramVerification', new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    inChannel: { type: Boolean, default: false },
    inGroup: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    // TTL: MongoDB auto-deletes the record 3 days after the last check
    lastChecked: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 3 },
    // daily Telegram-call limiter
    checksDay: { type: String, default: null },   // 'YYYY-MM-DD' (UTC)
    checksToday: { type: Number, default: 0 }
}));

module.exports = TelegramVerification;
