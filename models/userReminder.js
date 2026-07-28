const mongoose = require('mongoose');


const UserReminder = mongoose.model('UserReminder', new mongoose.Schema({
    user_id: { type: Number, required: true, index: true },
    last_reminder_sent: { type: Date, default: null },
    welcome_message_deleted: { type: Boolean, default: false },
    deleted_at: { type: Date, default: null },
    reminder_count: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}));

module.exports = UserReminder;
