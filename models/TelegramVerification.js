const mongoose = require('mongoose');


const TelegramVerification = mongoose.model('TelegramVerification', new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    inChannel: { type: Boolean, default: false },
    inGroup: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    lastChecked: { type: Date, default: Date.now }
}));

module.exports = TelegramVerification;
