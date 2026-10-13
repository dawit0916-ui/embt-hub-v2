const mongoose = require('mongoose');

module.exports = mongoose.model('UserNotifState', new mongoose.Schema({
    user_id: { type: Number, required: true, unique: true },
    muted: { type: Boolean, default: false },
    blocked: { type: Boolean, default: false },
    last_sent_at: { type: Date, default: null },
    last_by_type: { type: Map, of: Date, default: {} },
    last_active_at: { type: Date, default: Date.now }
}));
