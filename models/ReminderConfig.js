const mongoose = require('mongoose');



const ReminderConfig = mongoose.model('ReminderConfig', new mongoose.Schema({
    reminder_enabled: { type: Boolean, default: true },
    reminder_image_message_id: { type: Number, default: null },
    reminder_image_file_id: { type: String, default: null },
    last_updated: { type: Date, default: Date.now }
}));

module.exports = ReminderConfig;
