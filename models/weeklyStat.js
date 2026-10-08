const mongoose = require('mongoose');

const WeeklyStatSchema = new mongoose.Schema({
    week_key: { type: String, required: true },
    user_id: { type: Number, required: true },
    earned: { type: Number, default: 0 },
    invites: { type: Number, default: 0 }
});

WeeklyStatSchema.index({ week_key: 1, user_id: 1 }, { unique: true });
WeeklyStatSchema.index({ week_key: 1, earned: -1 });
WeeklyStatSchema.index({ week_key: 1, invites: -1 });

module.exports = mongoose.models.WeeklyStat || mongoose.model('WeeklyStat', WeeklyStatSchema);
